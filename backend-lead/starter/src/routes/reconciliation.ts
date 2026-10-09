import { Router } from 'express';
import { z } from 'zod';
import { reconcileWallet } from '../services/reconciliationService';

export const reconciliationRouter = Router();

const reconcileParams = z.object({ walletId: z.string().uuid() });

reconciliationRouter.post('/:walletId/reconcile', async (req, res, next) => {
  try {
    const { walletId } = reconcileParams.parse(req.params);
    const result = await reconcileWallet(walletId);
    if (result.kind === 'not_found') {
      res.status(404).json({ error: 'wallet not found' });
      return;
    }
    const { kind: _kind, ...response } = result;
    res.json(response);
  } catch (err) {
    next(err);
  }
});
