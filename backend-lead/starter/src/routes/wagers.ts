import { Router } from 'express';
import { z } from 'zod';
import { dec, isPositiveMoney } from '../lib/money';
import { placeWager } from '../services/wagerService';

export const wagersRouter = Router();

const wagerParams = z.object({ walletId: z.string().uuid() });
const wagerBody = z.object({
  amount: z.string().refine(isPositiveMoney, 'amount must be a positive decimal within DECIMAL(36,18)'),
});

wagersRouter.post('/:walletId/wagers', async (req, res, next) => {
  try {
    const { walletId } = wagerParams.parse(req.params);
    const { amount } = wagerBody.parse(req.body);
    const result = await placeWager(walletId, amount);
    if (result.kind === 'not_found') {
      res.status(404).json({ error: 'wallet not found' });
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
    res.status(201).json({ id: result.wager.id, amount: dec(result.wager.amount).toFixed(18) });
  } catch (err) {
    next(err);
  }
});
