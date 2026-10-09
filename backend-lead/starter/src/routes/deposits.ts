import { Router } from 'express';
import { z } from 'zod';
import { dec, fitsMoney, isPositiveMoney } from '../lib/money';
import * as depositService from '../services/depositService';

export const depositsRouter = Router();

const createDepositBody = z.object({
  memberId: z.string().uuid(),
  amount: z.string().refine(isPositiveMoney, 'amount must be a positive decimal within DECIMAL(36,18)'),
  turnoverMultiplier: z.number().int().nonnegative().safe().default(1),
}).superRefine((body, ctx) => {
  if (isPositiveMoney(body.amount) && !fitsMoney(dec(body.amount).times(body.turnoverMultiplier))) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['turnoverMultiplier'], message: 'turnover requirement exceeds DECIMAL(36,18)' });
  }
});

depositsRouter.post('/', async (req, res, next) => {
  try {
    const body = createDepositBody.parse(req.body);
    const deposit = await depositService.createDeposit(body.memberId, body.amount, body.turnoverMultiplier);
    if (!deposit) {
      res.status(404).json({ error: 'member not found' });
      return;
    }
    res.status(201).json({ id: deposit.id, pspRef: deposit.pspRef, status: deposit.status });
  } catch (err) {
    next(err);
  }
});
