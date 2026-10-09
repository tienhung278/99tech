import request from 'supertest';
import { createApp } from '../src/app';
import { sequelize } from '../src/db/sequelize';
import { Wallet } from '../src/db/models';
import '../src/db/models';
import { waitForWalletLockWaiters } from './support/walletLocks';

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

async function createMember(username: string) {
  const response = await request(app).post('/members').send({ username });
  expect(response.status).toBe(201);
  return { memberId: response.body.member.id as string, walletId: response.body.wallet.id as string };
}

async function completeDeposit(memberId: string, amount: string, turnoverMultiplier?: number) {
  const deposit = await request(app).post('/deposits').send({ memberId, amount, turnoverMultiplier });
  expect(deposit.status).toBe(201);
  const completion = await request(app).post('/psp/callbacks').send({
    pspRef: deposit.body.pspRef,
    status: 'completed',
    amount,
  });
  expect(completion.status).toBe(200);
  return deposit.body.id as string;
}

async function walletBalance(memberId: string) {
  const response = await request(app).get(`/members/${memberId}/wallet`);
  expect(response.status).toBe(200);
  return response.body.balance as string;
}

async function ledgerSummary(walletId: string) {
  const [rows] = await sequelize.query(
    `SELECT count(*)::integer AS count, coalesce(sum(amount), 0)::numeric(36,18) AS sum
     FROM wallet_ledger_entries WHERE wallet_id = :walletId`,
    { replacements: { walletId } },
  );
  return rows[0];
}

async function withdrawalCount(memberId: string) {
  const [rows] = await sequelize.query(
    'SELECT count(*)::integer AS count FROM withdrawals WHERE member_id = :memberId',
    { replacements: { memberId } },
  );
  return (rows[0] as { count: number }).count;
}

describe('POST /withdrawals', () => {
  it('allows a zero-multiplier deposit to be withdrawn and records a Pending debit', async () => {
    const { memberId, walletId } = await createMember('withdraw-zero-multiplier');
    const depositId = await completeDeposit(memberId, '20.75', 0);

    const response = await request(app).post('/withdrawals').send({ memberId, amount: '5.25' });

    expect(response.status).toBe(201);
    expect(response.body).toEqual({ id: expect.any(String), status: 'Pending', amount: '5.250000000000000000' });
    expect(await walletBalance(memberId)).toBe('15.500000000000000000');
    const [withdrawals] = await sequelize.query('SELECT id, member_id, amount, status FROM withdrawals');
    expect(withdrawals).toEqual([{
      id: response.body.id, member_id: memberId, amount: '5.250000000000000000', status: 'Pending',
    }]);
    const [ledger] = await sequelize.query(
      'SELECT event_key, amount FROM wallet_ledger_entries WHERE wallet_id = :walletId ORDER BY event_key',
      { replacements: { walletId } },
    );
    expect(ledger).toEqual([
      { event_key: `deposit:${depositId}`, amount: '20.750000000000000000' },
      { event_key: `withdrawal:${response.body.id}`, amount: '-5.250000000000000000' },
    ]);
  });

  it('blocks with exact outstanding turnover without moving funds, then allows withdrawal after wagering', async () => {
    const { memberId, walletId } = await createMember('withdraw-turnover');
    await completeDeposit(memberId, '10.10');
    const wager = await request(app).post(`/wallets/${walletId}/wagers`).send({ amount: '3.05' });
    expect(wager.status).toBe(201);

    const blocked = await request(app).post('/withdrawals').send({ memberId, amount: '1.00' });

    expect(blocked.status).toBe(422);
    expect(blocked.body).toEqual({ error: 'outstanding turnover', outstandingTurnover: '7.050000000000000000' });
    expect(await walletBalance(memberId)).toBe('7.050000000000000000');
    expect(await withdrawalCount(memberId)).toBe(0);
    expect(await ledgerSummary(walletId)).toEqual({ count: 2, sum: '7.050000000000000000' });

    await completeDeposit(memberId, '7.05', 0);
    const finalWager = await request(app).post(`/wallets/${walletId}/wagers`).send({ amount: '7.05' });
    expect(finalWager.status).toBe(201);
    const allowed = await request(app).post('/withdrawals').send({ memberId, amount: '7.00' });

    expect(allowed.status).toBe(201);
    expect(await walletBalance(memberId)).toBe('0.050000000000000000');
    expect(await withdrawalCount(memberId)).toBe(1);
    expect(await ledgerSummary(walletId)).toEqual({ count: 5, sum: '0.050000000000000000' });
  });

  it('counts wagers made before a later completed deposit toward lifetime turnover', async () => {
    const { memberId, walletId } = await createMember('withdraw-carryover');
    await completeDeposit(memberId, '10.00', 0);
    const wager = await request(app).post(`/wallets/${walletId}/wagers`).send({ amount: '5.00' });
    expect(wager.status).toBe(201);
    await completeDeposit(memberId, '5.00');

    const response = await request(app).post('/withdrawals').send({ memberId, amount: '6.00' });

    expect(response.status).toBe(201);
    expect(await walletBalance(memberId)).toBe('4.000000000000000000');
    expect(await ledgerSummary(walletId)).toEqual({ count: 4, sum: '4.000000000000000000' });
  });

  it.each(['0', '-1', '1.0000000000000000001', '1000000000000000000'])(
    'rejects invalid amount %s without moving funds', async (amount) => {
      const { memberId, walletId } = await createMember(`withdraw-invalid-${amount.replace(/[^0-9]/g, '')}`);
      await completeDeposit(memberId, '5.00', 0);

      const response = await request(app).post('/withdrawals').send({ memberId, amount });

      expect(response.status).toBe(400);
      expect(await walletBalance(memberId)).toBe('5.000000000000000000');
      expect(await withdrawalCount(memberId)).toBe(0);
      expect(await ledgerSummary(walletId)).toEqual({ count: 1, sum: '5.000000000000000000' });
    },
  );

  it('rejects an unaffordable eligible withdrawal without creating a debit', async () => {
    const { memberId, walletId } = await createMember('withdraw-insufficient');
    await completeDeposit(memberId, '5.00', 0);

    const response = await request(app).post('/withdrawals').send({ memberId, amount: '5.000000000000000001' });

    expect(response.status).toBe(422);
    expect(response.body).toEqual({ error: 'insufficient funds' });
    expect(await walletBalance(memberId)).toBe('5.000000000000000000');
    expect(await withdrawalCount(memberId)).toBe(0);
    expect(await ledgerSummary(walletId)).toEqual({ count: 1, sum: '5.000000000000000000' });
  });

  it('rolls back the withdrawal and balance when its ledger debit fails', async () => {
    const { memberId, walletId } = await createMember('withdraw-rollback');
    await completeDeposit(memberId, '5.00', 0);
    await sequelize.query(`
      CREATE FUNCTION test_reject_withdrawal_ledger() RETURNS trigger AS $$
      BEGIN
        IF NEW.event_key LIKE 'withdrawal:%' THEN
          RAISE EXCEPTION 'test ledger failure';
        END IF;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql;
      CREATE TRIGGER test_reject_withdrawal_ledger
      BEFORE INSERT ON wallet_ledger_entries
      FOR EACH ROW EXECUTE FUNCTION test_reject_withdrawal_ledger();
    `);
    const log = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      const response = await request(app).post('/withdrawals').send({ memberId, amount: '2.00' });

      expect(response.status).toBe(500);
      expect(await walletBalance(memberId)).toBe('5.000000000000000000');
      expect(await withdrawalCount(memberId)).toBe(0);
      expect(await ledgerSummary(walletId)).toEqual({ count: 1, sum: '5.000000000000000000' });
    } finally {
      log.mockRestore();
      await sequelize.query('DROP TRIGGER test_reject_withdrawal_ledger ON wallet_ledger_entries');
      await sequelize.query('DROP FUNCTION test_reject_withdrawal_ledger()');
    }
  });

  it('serializes simultaneous withdrawals whose combined amount exceeds the balance', async () => {
    const { memberId, walletId } = await createMember('withdraw-concurrent');
    await completeDeposit(memberId, '100.00', 0);
    const holder = await sequelize.transaction();
    let released = false;
    try {
      await Wallet.findByPk(walletId, { transaction: holder, lock: holder.LOCK.UPDATE });
      const first = request(app).post('/withdrawals').send({ memberId, amount: '60.00' }).then((response) => response);
      const second = request(app).post('/withdrawals').send({ memberId, amount: '60.00' }).then((response) => response);
      await waitForWalletLockWaiters(2);
      await holder.commit();
      released = true;
      const responses = await Promise.all([first, second]);
      expect(responses.map((response) => response.status).sort()).toEqual([201, 422]);
      expect(responses.find((response) => response.status === 422)?.body).toEqual({ error: 'insufficient funds' });
    } finally {
      if (!released) await holder.rollback();
    }

    expect(await walletBalance(memberId)).toBe('40.000000000000000000');
    expect(await withdrawalCount(memberId)).toBe(1);
    expect(await ledgerSummary(walletId)).toEqual({ count: 2, sum: '40.000000000000000000' });
    const [withdrawals] = await sequelize.query('SELECT id, status FROM withdrawals WHERE member_id = :memberId', {
      replacements: { memberId },
    });
    const [debits] = await sequelize.query(
      "SELECT event_key, amount FROM wallet_ledger_entries WHERE wallet_id = :walletId AND event_key LIKE 'withdrawal:%'",
      { replacements: { walletId } },
    );
    expect(withdrawals).toEqual([{ id: expect.any(String), status: 'Pending' }]);
    expect(debits).toEqual([{ event_key: `withdrawal:${(withdrawals[0] as { id: string }).id}`, amount: '-60.000000000000000000' }]);
  }, 30000);

  it('sees turnover from a deposit completed while a withdrawal waits on the wallet', async () => {
    const { memberId, walletId } = await createMember('withdraw-deposit-race');
    await completeDeposit(memberId, '100.00', 0);
    const deposit = await request(app).post('/deposits').send({ memberId, amount: '50.00' });
    expect(deposit.status).toBe(201);
    const holder = await sequelize.transaction();
    let released = false;
    try {
      await Wallet.findByPk(walletId, { transaction: holder, lock: holder.LOCK.UPDATE });
      const callback = request(app).post('/psp/callbacks').send({
        pspRef: deposit.body.pspRef, status: 'completed', amount: '50.00',
      }).then((response) => response);
      await waitForWalletLockWaiters(1);
      const withdrawal = request(app).post('/withdrawals').send({ memberId, amount: '60.00' }).then((response) => response);
      await waitForWalletLockWaiters(2);
      await holder.commit();
      released = true;
      const [callbackResponse, withdrawalResponse] = await Promise.all([callback, withdrawal]);
      expect(callbackResponse.status).toBe(200);
      expect(withdrawalResponse.status).toBe(422);
      expect(withdrawalResponse.body).toEqual({
        error: 'outstanding turnover', outstandingTurnover: '50.000000000000000000',
      });
    } finally {
      if (!released) await holder.rollback();
    }

    expect(await walletBalance(memberId)).toBe('150.000000000000000000');
    expect(await withdrawalCount(memberId)).toBe(0);
    expect(await ledgerSummary(walletId)).toEqual({ count: 2, sum: '150.000000000000000000' });
  }, 30000);
});
