import request from 'supertest';
import { createApp } from '../src/app';
import { sequelize } from '../src/db/sequelize';
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

async function createMember(username: string) {
  const response = await request(app).post('/members').send({ username });
  expect(response.status).toBe(201);
  return { memberId: response.body.member.id as string, walletId: response.body.wallet.id as string };
}

async function deposit(memberId: string, amount: string, turnoverMultiplier = 0) {
  const response = await request(app).post('/deposits').send({ memberId, amount, turnoverMultiplier });
  expect(response.status).toBe(201);
  return { id: response.body.id as string, pspRef: response.body.pspRef as string };
}

async function completeDeposit(pspRef: string, amount: string) {
  const response = await request(app).post('/psp/callbacks').send({ pspRef, status: 'completed', amount });
  expect(response.status).toBe(200);
}

async function ledger(walletId: string) {
  const [rows] = await sequelize.query(
    'SELECT event_key, amount FROM wallet_ledger_entries WHERE wallet_id = :walletId ORDER BY event_key',
    { replacements: { walletId } },
  );
  return rows;
}

it('reports a matching wallet and leaves it usable', async () => {
  const { memberId, walletId } = await createMember('reconcile-matching');
  const initial = await deposit(memberId, '7.25');
  await completeDeposit(initial.pspRef, '7.25');

  const result = await request(app).post(`/wallets/${walletId}/reconcile`);

  expect(result.status).toBe(200);
  expect(result.body).toEqual({
    walletId,
    ledgerTotal: '7.250000000000000000',
    operationalBalance: '7.250000000000000000',
    difference: '0.000000000000000000',
    differenceBasis: 'ledgerTotal - operationalBalance',
    frozen: false,
  });
  const wager = await request(app).post(`/wallets/${walletId}/wagers`).send({ amount: '1.25' });
  expect(wager.status).toBe(201);
});

it('freezes a discrepancy and blocks all further money movements without changing their records', async () => {
  const { memberId, walletId } = await createMember('reconcile-discrepancy');
  const initial = await deposit(memberId, '20.125');
  await completeDeposit(initial.pspRef, '20.125');
  const pending = await deposit(memberId, '2.00');
  const before = await ledger(walletId);

  // Deliberately damage the operational copy; the signed ledger remains authoritative.
  await sequelize.query('UPDATE wallets SET balance = :balance WHERE id = :walletId', {
    replacements: { balance: '22.125', walletId },
  });

  const result = await request(app).post(`/wallets/${walletId}/reconcile`);
  expect(result.status).toBe(200);
  expect(result.body).toEqual({
    walletId,
    ledgerTotal: '20.125000000000000000',
    operationalBalance: '22.125000000000000000',
    difference: '-2.000000000000000000',
    differenceBasis: 'ledgerTotal - operationalBalance',
    frozen: true,
  });
  expect(await ledger(walletId)).toEqual(before);

  const callback = await request(app).post('/psp/callbacks').send({
    pspRef: pending.pspRef, status: 'completed', amount: '2.00',
  });
  const wager = await request(app).post(`/wallets/${walletId}/wagers`).send({ amount: '1.00' });
  const withdrawal = await request(app).post('/withdrawals').send({ memberId, amount: '1.00' });
  for (const blocked of [callback, wager, withdrawal]) {
    expect(blocked.status).toBe(423);
    expect(blocked.body).toEqual({ error: 'wallet frozen' });
  }

  const wallet = await request(app).get(`/members/${memberId}/wallet`);
  expect(wallet.body.balance).toBe('22.125000000000000000');
  const [deposits] = await sequelize.query('SELECT status FROM deposits WHERE id = :id', {
    replacements: { id: pending.id },
  });
  expect(deposits).toEqual([{ status: 'Pending' }]);
  const [wagers] = await sequelize.query('SELECT id FROM wagers WHERE wallet_id = :walletId', {
    replacements: { walletId },
  });
  const [withdrawals] = await sequelize.query('SELECT id FROM withdrawals WHERE member_id = :memberId', {
    replacements: { memberId },
  });
  expect(wagers).toEqual([]);
  expect(withdrawals).toEqual([]);
  expect(await ledger(walletId)).toEqual(before);
});
