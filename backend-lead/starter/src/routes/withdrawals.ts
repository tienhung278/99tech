import { Router } from 'express';
import { z } from 'zod';
import { dec, isPositiveMoney } from '../lib/money';
import { requestWithdrawal } from '../services/withdrawalService';

export const withdrawalsRouter = Router();

const withdrawalBody = z.object({
  memberId: z.string().uuid(),
  amount: z.string().refine(isPositiveMoney, 'amount must be a positive decimal within DECIMAL(36,18)'),
});

withdrawalsRouter.post('/', async (req, res, next) => {
  try {
    const { memberId, amount } = withdrawalBody.parse(req.body);
    const result = await requestWithdrawal(memberId, amount);
    if (result.kind === 'not_found') {
      res.status(404).json({ error: 'wallet not found' });
      return;
    }
    if (result.kind === 'outstanding_turnover') {
      res.status(422).json({ error: 'outstanding turnover', outstandingTurnover: result.outstandingTurnover });
      return;
    }
    if (result.kind === 'insufficient_funds') {
      res.status(422).json({ error: 'insufficient funds' });
      return;
    }
    if (result.kind === 'wallet_frozen') {
      res.status(423).json({ error: 'wallet frozen' });
      return;
    }
    res.status(201).json({
      id: result.withdrawal.id,
      status: result.withdrawal.status,
      amount: dec(result.withdrawal.amount).toFixed(18),
    });
  } catch (err) {
    next(err);
  }
});
