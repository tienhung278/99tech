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

describe('POST /deposits', () => {
  it('creates a Pending mock deposit without moving wallet funds', async () => {
    const member = await request(app).post('/members').send({ username: 'deposit-member-01' });
    expect(member.status).toBe(201);

    const response = await request(app).post('/deposits').send({
      memberId: member.body.member.id,
      amount: '100.50',
    });

    expect(response.status).toBe(201);
    expect(response.body).toEqual({
      id: expect.any(String),
      pspRef: expect.any(String),
      status: 'Pending',
    });

    const [deposits] = await sequelize.query(
      'SELECT id, member_id, amount, turnover_multiplier, provider_id, psp_ref, status FROM deposits',
    );
    expect(deposits).toEqual([
      {
        id: response.body.id,
        member_id: member.body.member.id,
        amount: '100.500000000000000000',
        turnover_multiplier: '1',
        provider_id: 'mock',
        psp_ref: response.body.pspRef,
        status: 'Pending',
      },
    ]);

    const wallet = await request(app).get(`/members/${member.body.member.id}/wallet`);
    expect(wallet.status).toBe(200);
    expect(wallet.body.balance).toBe('0.000000000000000000');
  });

  it('accepts a zero multiplier and gives each deposit a distinct PSP reference', async () => {
    const member = await request(app).post('/members').send({ username: 'deposit-member-02' });
    const first = await request(app).post('/deposits').send({
      memberId: member.body.member.id,
      amount: '0.000000000000000001',
      turnoverMultiplier: 0,
    });
    const second = await request(app).post('/deposits').send({
      memberId: member.body.member.id,
      amount: '999999999999999999.999999999999999999',
    });

    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    expect(first.body.pspRef).not.toBe(second.body.pspRef);

    const [deposits] = await sequelize.query(
      'SELECT id, turnover_multiplier FROM deposits ORDER BY created_at, id',
    );
    expect(deposits).toEqual(expect.arrayContaining([
      { id: first.body.id, turnover_multiplier: '0' },
      { id: second.body.id, turnover_multiplier: '1' },
    ]));
  });

  it.each([
    ['excess precision', { amount: '1.0000000000000000001' }],
    ['amount overflow', { amount: '1000000000000000000' }],
    ['turnover overflow', { amount: '999999999999999999.999999999999999999', turnoverMultiplier: 2 }],
    ['negative multiplier', { amount: '1.00', turnoverMultiplier: -1 }],
    ['fractional multiplier', { amount: '1.00', turnoverMultiplier: 1.5 }],
  ])('rejects %s without creating a deposit', async (_case, input) => {
    const member = await request(app).post('/members').send({ username: 'deposit-member-invalid' });
    const response = await request(app).post('/deposits').send({
      memberId: member.body.member.id,
      ...input,
    });

    expect(response.status).toBe(400);
    const [rows] = await sequelize.query('SELECT count(*)::integer AS count FROM deposits');
    expect(rows).toEqual([{ count: 0 }]);
  });
});
