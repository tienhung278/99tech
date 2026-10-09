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

async function pendingDeposit(username: string, amount = '100.50') {
  const member = await request(app).post('/members').send({ username });
  expect(member.status).toBe(201);
  const deposit = await request(app).post('/deposits').send({ memberId: member.body.member.id, amount });
  expect(deposit.status).toBe(201);
  return { memberId: member.body.member.id as string, depositId: deposit.body.id as string, pspRef: deposit.body.pspRef as string };
}

async function walletBalance(memberId: string) {
  const response = await request(app).get(`/members/${memberId}/wallet`);
  expect(response.status).toBe(200);
  return response.body.balance as string;
}

async function depositAndLedger(depositId: string) {
  const [deposits] = await sequelize.query('SELECT status FROM deposits WHERE id = :depositId', {
    replacements: { depositId },
  });
  const [ledger] = await sequelize.query(
    "SELECT event_key, amount FROM wallet_ledger_entries ORDER BY event_key",
  );
  return { deposits, ledger };
}

async function ledgerSummary() {
  const [rows] = await sequelize.query(
    'SELECT count(*)::integer AS count, coalesce(sum(amount), 0)::numeric(36,18) AS sum FROM wallet_ledger_entries',
  );
  return rows[0];
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
  throw new Error(`Expected ${expected} callbacks waiting on wallet locks`);
}

describe('POST /psp/callbacks', () => {
  it('completes a deposit with one signed credit and matching wallet balance', async () => {
    const { memberId, depositId, pspRef } = await pendingDeposit('callback-completed');

    const response = await request(app).post('/psp/callbacks').send({
      pspRef,
      status: 'completed',
      amount: '100.5000',
    });

    expect(response.status).toBe(200);
    expect(response.body.status).toBe('Completed');
    expect(await walletBalance(memberId)).toBe('100.500000000000000000');
    expect(await depositAndLedger(depositId)).toEqual({
      deposits: [{ status: 'Completed' }],
      ledger: [{ event_key: `deposit:${depositId}`, amount: '100.500000000000000000' }],
    });
    expect(await ledgerSummary()).toEqual({ count: 1, sum: '100.500000000000000000' });
  });

  it('acknowledges a sequential retry without another credit', async () => {
    const { memberId, depositId, pspRef } = await pendingDeposit('callback-retry');
    const callback = { pspRef, status: 'completed', amount: '100.50' };

    expect((await request(app).post('/psp/callbacks').send(callback)).status).toBe(200);
    const retry = await request(app).post('/psp/callbacks').send(callback);

    expect(retry.status).toBe(200);
    expect(retry.body.status).toBe('Completed');
    expect(await walletBalance(memberId)).toBe('100.500000000000000000');
    expect(await depositAndLedger(depositId)).toEqual({
      deposits: [{ status: 'Completed' }],
      ledger: [{ event_key: `deposit:${depositId}`, amount: '100.500000000000000000' }],
    });
  });

  it('marks a failed deposit terminal without moving money', async () => {
    const { memberId, depositId, pspRef } = await pendingDeposit('callback-failed');
    const failure = await request(app).post('/psp/callbacks').send({
      pspRef, status: 'failed', amount: '100.50',
    });
    const duplicate = await request(app).post('/psp/callbacks').send({
      pspRef, status: 'failed', amount: '100.50',
    });
    const laterSuccess = await request(app).post('/psp/callbacks').send({
      pspRef, status: 'completed', amount: '100.50',
    });

    expect(failure.status).toBe(200);
    expect(failure.body.status).toBe('Failed');
    expect(duplicate.status).toBe(200);
    expect(laterSuccess.status).toBe(409);
    expect(await walletBalance(memberId)).toBe('0.000000000000000000');
    expect(await depositAndLedger(depositId)).toEqual({
      deposits: [{ status: 'Failed' }], ledger: [],
    });
    expect(await ledgerSummary()).toEqual({ count: 0, sum: '0.000000000000000000' });
  });

  it('credits once when two completed callbacks are in flight together', async () => {
    const { memberId, depositId, pspRef } = await pendingDeposit('callback-concurrent');
    const wallet = await Wallet.findOne({ where: { memberId } });
    expect(wallet).not.toBeNull();
    const holder = await sequelize.transaction();
    let released = false;
    try {
      await Wallet.findByPk(wallet!.id, { transaction: holder, lock: holder.LOCK.UPDATE });
      const callback = { pspRef, status: 'completed', amount: '100.50' };
      const first = request(app).post('/psp/callbacks').send(callback).then((response) => response);
      const second = request(app).post('/psp/callbacks').send(callback).then((response) => response);
      await waitForWalletLockWaiters(2);
      await holder.commit();
      released = true;
      const responses = await Promise.all([first, second]);
      expect(responses.map((response) => response.status)).toEqual([200, 200]);
      expect(responses.map((response) => response.body.status)).toEqual(['Completed', 'Completed']);
    } finally {
      if (!released) await holder.rollback();
    }

    expect(await walletBalance(memberId)).toBe('100.500000000000000000');
    expect(await depositAndLedger(depositId)).toEqual({
      deposits: [{ status: 'Completed' }],
      ledger: [{ event_key: `deposit:${depositId}`, amount: '100.500000000000000000' }],
    });
    expect(await ledgerSummary()).toEqual({ count: 1, sum: '100.500000000000000000' });
  }, 30000);

  it('rolls back the credit and balance if the final state write fails', async () => {
    const { memberId, depositId, pspRef } = await pendingDeposit('callback-rollback');
    await sequelize.query(
      "ALTER TABLE deposits ADD CONSTRAINT test_reject_completion CHECK (status <> 'Completed')",
    );
    const log = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      const response = await request(app).post('/psp/callbacks').send({
        pspRef, status: 'completed', amount: '100.50',
      });
      expect(response.status).toBe(500);
      expect(await walletBalance(memberId)).toBe('0.000000000000000000');
      expect(await depositAndLedger(depositId)).toEqual({
        deposits: [{ status: 'Pending' }], ledger: [],
      });
      expect(await ledgerSummary()).toEqual({ count: 0, sum: '0.000000000000000000' });
    } finally {
      log.mockRestore();
      await sequelize.query('ALTER TABLE deposits DROP CONSTRAINT test_reject_completion');
    }
  });

  it('leaves a deposit Pending when crediting it would exceed the money column', async () => {
    const { memberId, pspRef: firstRef } = await pendingDeposit(
      'callback-balance-limit', '999999999999999999.999999999999999999',
    );
    const first = await request(app).post('/psp/callbacks').send({
      pspRef: firstRef, status: 'completed', amount: '999999999999999999.999999999999999999',
    });
    expect(first.status).toBe(200);
    const second = await request(app).post('/deposits').send({
      memberId, amount: '0.000000000000000001',
    });
    expect(second.status).toBe(201);

    const overflow = await request(app).post('/psp/callbacks').send({
      pspRef: second.body.pspRef, status: 'completed', amount: '0.000000000000000001',
    });

    expect(overflow.status).toBe(422);
    expect(await walletBalance(memberId)).toBe('999999999999999999.999999999999999999');
    const [rows] = await sequelize.query('SELECT status FROM deposits WHERE id = :id', {
      replacements: { id: second.body.id },
    });
    expect(rows).toEqual([{ status: 'Pending' }]);
    expect(await ledgerSummary()).toEqual({ count: 1, sum: '999999999999999999.999999999999999999' });
  });
});
