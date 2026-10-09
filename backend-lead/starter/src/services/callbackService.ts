import { sequelize } from '../db/sequelize';
import { Deposit, Wallet, WalletLedgerEntry } from '../db/models';
import { dec, fitsMoney } from '../lib/money';

export type CallbackResult =
  | { kind: 'settled'; status: 'Completed' | 'Failed' }
  | { kind: 'not_found' | 'amount_mismatch' | 'conflicting_status' | 'balance_overflow' };

export async function settleMockCallback(
  pspRef: string,
  status: 'completed' | 'failed',
  amount: string,
): Promise<CallbackResult> {
  // The first read locates the immutable owner only. Decisions use the locked copy below.
  const locator = await Deposit.findOne({ where: { providerId: 'mock', pspRef } });
  if (!locator) {
    return { kind: 'not_found' };
  }

  return sequelize.transaction(async (transaction) => {
    // Every wallet writer takes this lock first, including future wager and withdrawal paths.
    const wallet = await Wallet.findOne({
      where: { memberId: locator.memberId },
      transaction,
      lock: transaction.LOCK.UPDATE,
    });
    if (!wallet) {
      throw new Error(`Deposit ${locator.id} has no wallet`);
    }
    const deposit = await Deposit.findByPk(locator.id, {
      transaction,
      lock: transaction.LOCK.UPDATE,
    });
    if (!deposit || deposit.providerId !== 'mock' || deposit.pspRef !== pspRef || deposit.memberId !== wallet.memberId) {
      throw new Error(`Deposit ${locator.id} changed ownership`);
    }

    const targetStatus = status === 'completed' ? 'Completed' : 'Failed';
    if (deposit.status !== 'Pending' && deposit.status !== targetStatus) {
      return { kind: 'conflicting_status' } as const;
    }
    if (!dec(deposit.amount).isEqualTo(dec(amount))) {
      return { kind: 'amount_mismatch' } as const;
    }
    if (deposit.status !== 'Pending') {
      return { kind: 'settled', status: targetStatus } as const;
    }

    if (targetStatus === 'Completed') {
      const nextBalance = dec(wallet.balance).plus(deposit.amount);
      if (!fitsMoney(nextBalance)) {
        return { kind: 'balance_overflow' } as const;
      }
      await WalletLedgerEntry.create({
        walletId: wallet.id,
        eventKey: `deposit:${deposit.id}`,
        amount: deposit.amount,
      }, { transaction });
      await wallet.update({ balance: nextBalance.toFixed(18) }, { transaction });
    }
    await deposit.update({ status: targetStatus }, { transaction });
    return { kind: 'settled', status: targetStatus } as const;
  });
}
