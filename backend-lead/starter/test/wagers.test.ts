import request from 'supertest';
import { createApp } from '../src/app';
import { sequelize } from '../src/db/sequelize';
import { Wallet } from '../src/db/models';
import '../src/db/models';

const app = createApp();

beforeAll(async () => {
  await sequelize.authenticate();
});

beforeEach(async () => {
  await sequelize.truncate({ cascade: true });
});

afterAll(async () => {
  await sequelize.close();
});

async function fundedWallet(username: string, amount: string) {
  const member = await request(app).post('/members').send({ username });
  expect(member.status).toBe(201);
  const deposit = await request(app).post('/deposits').send({ memberId: member.body.member.id, amount });
  expect(deposit.status).toBe(201);
  const completion = await request(app).post('/psp/callbacks').send({
    pspRef: deposit.body.pspRef,
    status: 'completed',
    amount,
  });
  expect(completion.status).toBe(200);
  return { walletId: member.body.wallet.id as string, memberId: member.body.member.id as string };
}

async function walletBalance(memberId: string) {
  const response = await request(app).get(`/members/${memberId}/wallet`);
  expect(response.status).toBe(200);
  return response.body.balance as string;
}

async function waitForWalletLockWaiters(expected: number) {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    const [rows] = await sequelize.query(
      `SELECT count(*)::integer AS count FROM pg_stat_activity
       WHERE datname = current_database() AND wait_event_type = 'Lock'
       AND query ILIKE '%wallets%'`,
    );
    if ((rows[0] as { count: number }).count >= expected) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`Expected ${expected} wagers waiting on wallet locks`);
}

describe('POST /wallets/:walletId/wagers', () => {
  it('accepts an exact positive stake and records one debit with the remaining balance', async () => {
    const { walletId, memberId } = await fundedWallet('wager-accepted', '100.50');

    const response = await request(app).post(`/wallets/${walletId}/wagers`).send({ amount: '10.25' });

    expect(response.status).toBe(201);
    expect(response.body).toEqual({ id: expect.any(String), amount: '10.250000000000000000' });
    expect(await walletBalance(memberId)).toBe('90.250000000000000000');
    const [wagers] = await sequelize.query(
      'SELECT id, wallet_id, amount FROM wagers WHERE wallet_id = :walletId',
      { replacements: { walletId } },
    );
    expect(wagers).toEqual([{
      id: response.body.id,
      wallet_id: walletId,
      amount: '10.250000000000000000',
    }]);
    const [ledger] = await sequelize.query(
      'SELECT event_key, amount FROM wallet_ledger_entries WHERE wallet_id = :walletId ORDER BY event_key',
      { replacements: { walletId } },
    );
    expect(ledger).toEqual([
      { event_key: expect.stringMatching(/^deposit:/), amount: '100.500000000000000000' },
      { event_key: `wager:${response.body.id}`, amount: '-10.250000000000000000' },
    ]);
    const [summary] = await sequelize.query(
      'SELECT count(*)::integer AS count, sum(amount)::numeric(36,18) AS sum FROM wallet_ledger_entries WHERE wallet_id = :walletId',
      { replacements: { walletId } },
    );
    expect(summary).toEqual([{ count: 2, sum: '90.250000000000000000' }]);
  });

  it('rejects an unaffordable stake without a wager, debit, or balance change', async () => {
    const { walletId, memberId } = await fundedWallet('wager-insufficient', '5.00');

    const response = await request(app).post(`/wallets/${walletId}/wagers`).send({ amount: '5.000000000000000001' });

    expect(response.status).toBe(422);
    expect(response.body).toEqual({ error: 'insufficient funds' });
    expect(await walletBalance(memberId)).toBe('5.000000000000000000');
    const [wagers] = await sequelize.query('SELECT count(*)::integer AS count FROM wagers WHERE wallet_id = :walletId', {
      replacements: { walletId },
    });
    expect(wagers).toEqual([{ count: 0 }]);
    const [ledger] = await sequelize.query(
      'SELECT count(*)::integer AS count, sum(amount)::numeric(36,18) AS sum FROM wallet_ledger_entries WHERE wallet_id = :walletId',
      { replacements: { walletId } },
    );
    expect(ledger).toEqual([{ count: 1, sum: '5.000000000000000000' }]);
  });

  it.each(['0', '-1', '1.0000000000000000001', '1000000000000000000'])(
    'rejects invalid stake %s before moving funds', async (amount) => {
      const { walletId, memberId } = await fundedWallet(`wager-invalid-${amount.replace(/[^0-9]/g, '')}`, '5.00');

      const response = await request(app).post(`/wallets/${walletId}/wagers`).send({ amount });

      expect(response.status).toBe(400);
      expect(await walletBalance(memberId)).toBe('5.000000000000000000');
      const [wagers] = await sequelize.query('SELECT count(*)::integer AS count FROM wagers WHERE wallet_id = :walletId', {
        replacements: { walletId },
      });
      expect(wagers).toEqual([{ count: 0 }]);
      const [ledger] = await sequelize.query(
        'SELECT count(*)::integer AS count, sum(amount)::numeric(36,18) AS sum FROM wallet_ledger_entries WHERE wallet_id = :walletId',
        { replacements: { walletId } },
      );
      expect(ledger).toEqual([{ count: 1, sum: '5.000000000000000000' }]);
    },
  );

  it('serializes simultaneous stakes whose combined amount exceeds the balance', async () => {
    const { walletId, memberId } = await fundedWallet('wager-concurrent', '100.00');
    const holder = await sequelize.transaction();
    let released = false;
    try {
      await Wallet.findByPk(walletId, { transaction: holder, lock: holder.LOCK.UPDATE });
      const first = request(app).post(`/wallets/${walletId}/wagers`).send({ amount: '60.00' }).then((response) => response);
      const second = request(app).post(`/wallets/${walletId}/wagers`).send({ amount: '60.00' }).then((response) => response);
      await waitForWalletLockWaiters(2);
      await holder.commit();
      released = true;
      const responses = await Promise.all([first, second]);
      expect(responses.map((response) => response.status).sort()).toEqual([201, 422]);
    } finally {
      if (!released) await holder.rollback();
    }

    expect(await walletBalance(memberId)).toBe('40.000000000000000000');
    const [wagers] = await sequelize.query('SELECT id, amount FROM wagers WHERE wallet_id = :walletId', {
      replacements: { walletId },
    });
    expect(wagers).toEqual([{ id: expect.any(String), amount: '60.000000000000000000' }]);
    const [ledger] = await sequelize.query(
      'SELECT event_key, amount FROM wallet_ledger_entries WHERE wallet_id = :walletId ORDER BY event_key',
      { replacements: { walletId } },
    );
    expect(ledger).toEqual([
      { event_key: expect.stringMatching(/^deposit:/), amount: '100.000000000000000000' },
      { event_key: `wager:${(wagers[0] as { id: string }).id}`, amount: '-60.000000000000000000' },
    ]);
    const [summary] = await sequelize.query(
      'SELECT count(*)::integer AS count, sum(amount)::numeric(36,18) AS sum FROM wallet_ledger_entries WHERE wallet_id = :walletId',
      { replacements: { walletId } },
    );
    expect(summary).toEqual([{ count: 2, sum: '40.000000000000000000' }]);
  }, 30000);
});
