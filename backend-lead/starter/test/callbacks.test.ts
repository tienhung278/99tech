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

async function callbackAudits() {
  const [rows] = await sequelize.query(
    `SELECT provider_id, psp_ref, deposit_id, reported_status, reported_amount,
            outcome, reconciliation_required
     FROM psp_callback_audits ORDER BY created_at, id`,
  );
  return rows;
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
  it('returns 404 and records an unknown PSP reference without changing funds', async () => {
    const { memberId, depositId } = await pendingDeposit('callback-unknown');
    const unknownRef = 'unknown-psp-reference'.repeat(10);

    const response = await request(app).post('/psp/callbacks').send({
      pspRef: unknownRef, status: 'completed', amount: '12.00',
    });

    expect(response.status).toBe(404);
    expect(await walletBalance(memberId)).toBe('0.000000000000000000');
    expect(await depositAndLedger(depositId)).toEqual({ deposits: [{ status: 'Pending' }], ledger: [] });
    expect(await callbackAudits()).toEqual([{
      provider_id: 'mock', psp_ref: unknownRef, deposit_id: null,
      reported_status: 'completed', reported_amount: '12.00',
      outcome: 'unknown_reference', reconciliation_required: false,
    }]);
  });

  it('keeps a mismatched deposit Pending, then settles a numerically matching callback', async () => {
    const { memberId, depositId, pspRef } = await pendingDeposit('callback-mismatch', '12.50');

    const mismatch = await request(app).post('/psp/callbacks').send({
      pspRef, status: 'completed', amount: '12.51',
    });

    expect(mismatch.status).toBe(409);
    expect(await walletBalance(memberId)).toBe('0.000000000000000000');
    expect(await depositAndLedger(depositId)).toEqual({ deposits: [{ status: 'Pending' }], ledger: [] });
    expect(await callbackAudits()).toEqual([{
      provider_id: 'mock', psp_ref: pspRef, deposit_id: depositId,
      reported_status: 'completed', reported_amount: '12.51',
      outcome: 'amount_mismatch', reconciliation_required: false,
    }]);

    const matching = await request(app).post('/psp/callbacks').send({
      pspRef, status: 'completed', amount: '12.5000',
    });

    expect(matching.status).toBe(200);
    expect(matching.body.status).toBe('Completed');
    expect(await walletBalance(memberId)).toBe('12.500000000000000000');
    expect(await depositAndLedger(depositId)).toEqual({
      deposits: [{ status: 'Completed' }],
      ledger: [{ event_key: `deposit:${depositId}`, amount: '12.500000000000000000' }],
    });
    expect(await callbackAudits()).toHaveLength(1);
  });

  it('acknowledges and records a late pending event after completion without changing funds', async () => {
    const { memberId, depositId, pspRef } = await pendingDeposit('callback-stale', '7.25');
    const completed = await request(app).post('/psp/callbacks').send({
      pspRef, status: 'completed', amount: '7.25',
    });
    expect(completed.status).toBe(200);

    const stale = await request(app).post('/psp/callbacks').send({
      pspRef, status: 'pending', amount: '7.25',
    });

    expect(stale.status).toBe(200);
    expect(stale.body.status).toBe('Completed');
    expect(await walletBalance(memberId)).toBe('7.250000000000000000');
    expect(await depositAndLedger(depositId)).toEqual({
      deposits: [{ status: 'Completed' }],
      ledger: [{ event_key: `deposit:${depositId}`, amount: '7.250000000000000000' }],
    });
    expect(await callbackAudits()).toEqual([{
      provider_id: 'mock', psp_ref: pspRef, deposit_id: depositId,
      reported_status: 'pending', reported_amount: '7.25',
      outcome: 'stale_pending', reconciliation_required: false,
    }]);
  });

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
    expect(await callbackAudits()).toEqual([{
      provider_id: 'mock', psp_ref: pspRef, deposit_id: depositId,
      reported_status: 'completed', reported_amount: '100.50',
      outcome: 'contradictory_terminal', reconciliation_required: true,
    }]);
  });

  it('flags a failed callback after completion without reversing the credit', async () => {
    const { memberId, depositId, pspRef } = await pendingDeposit('callback-contradiction', '9.75');
    const completed = await request(app).post('/psp/callbacks').send({
      pspRef, status: 'completed', amount: '9.75',
    });
    expect(completed.status).toBe(200);

    const contradictory = await request(app).post('/psp/callbacks').send({
      pspRef, status: 'failed', amount: '9.75',
    });

    expect(contradictory.status).toBe(409);
    expect(await walletBalance(memberId)).toBe('9.750000000000000000');
    expect(await depositAndLedger(depositId)).toEqual({
      deposits: [{ status: 'Completed' }],
      ledger: [{ event_key: `deposit:${depositId}`, amount: '9.750000000000000000' }],
    });
    expect(await callbackAudits()).toEqual([{
      provider_id: 'mock', psp_ref: pspRef, deposit_id: depositId,
      reported_status: 'failed', reported_amount: '9.75',
      outcome: 'contradictory_terminal', reconciliation_required: true,
    }]);
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
