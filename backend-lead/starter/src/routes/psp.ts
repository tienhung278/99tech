import { Router } from 'express';
import { z } from 'zod';
import { isPositiveMoney } from '../lib/money';
import { settleMockCallback } from '../services/callbackService';

export const pspRouter = Router();

const callbackBody = z.object({
  pspRef: z.string().min(1),
  status: z.enum(['completed', 'failed']),
  amount: z.string().refine(isPositiveMoney, 'amount must be a positive decimal within DECIMAL(36,18)'),
});

pspRouter.post('/callbacks', async (req, res, next) => {
  try {
    const body = callbackBody.parse(req.body);
    const result = await settleMockCallback(body.pspRef, body.status, body.amount);
    switch (result.kind) {
      case 'settled':
        res.status(200).json({ status: result.status });
        return;
      case 'not_found':
        res.status(404).json({ error: 'deposit not found' });
        return;
      case 'amount_mismatch':
        res.status(409).json({ error: 'callback amount mismatch' });
        return;
      case 'conflicting_status':
        res.status(409).json({ error: 'conflicting terminal status' });
        return;
      case 'balance_overflow':
        res.status(422).json({ error: 'wallet balance exceeds DECIMAL(36,18)' });
        return;
    }
  } catch (err) {
    next(err);
  }
});
