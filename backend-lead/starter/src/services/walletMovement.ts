import BigNumber from 'bignumber.js';
import { Transaction } from 'sequelize';
import { Wallet, WalletLedgerEntry } from '../db/models';
import { dec } from '../lib/money';

export function balanceAfterMovement(wallet: Wallet, signedAmount: string): BigNumber {
  return dec(wallet.balance).plus(signedAmount);
}

// Callers hold the wallet row lock and check their own spending or overflow rule
// before creating the business event. The event, ledger entry, and balance share
// the caller's transaction.
export async function recordWalletMovement(
  wallet: Wallet,
  eventKey: string,
  signedAmount: string,
  transaction: Transaction,
): Promise<void> {
  const nextBalance = balanceAfterMovement(wallet, signedAmount);
  await WalletLedgerEntry.create({
    walletId: wallet.id,
    eventKey,
    amount: signedAmount,
  }, { transaction });
  await wallet.update({ balance: nextBalance.toFixed(18) }, { transaction });
}
