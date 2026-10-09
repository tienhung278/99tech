import { sequelize } from '../../src/db/sequelize';

export async function waitForWalletLockWaiters(expected: number): Promise<void> {
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
  throw new Error(`Expected ${expected} requests waiting on wallet locks`);
}
