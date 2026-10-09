'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('psp_callback_audits', {
      id: {
        type: Sequelize.UUID,
        primaryKey: true,
        defaultValue: Sequelize.literal('gen_random_uuid()'),
      },
      provider_id: { type: Sequelize.STRING(64), allowNull: false },
      psp_ref: { type: Sequelize.TEXT, allowNull: false },
      deposit_id: { type: Sequelize.UUID, allowNull: true },
      reported_status: { type: Sequelize.STRING(16), allowNull: false },
      reported_amount: { type: Sequelize.TEXT, allowNull: false },
      outcome: { type: Sequelize.STRING(32), allowNull: false },
      reconciliation_required: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: false },
      created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('now()') },
    });
    await queryInterface.sequelize.query(`
      ALTER TABLE psp_callback_audits
      ADD CONSTRAINT psp_callback_audits_status_valid
        CHECK (reported_status IN ('pending', 'completed', 'failed')),
      ADD CONSTRAINT psp_callback_audits_outcome_valid
        CHECK (outcome IN ('unknown_reference', 'amount_mismatch', 'stale_pending', 'contradictory_terminal')),
      ADD CONSTRAINT psp_callback_audits_reconciliation_valid
        CHECK (reconciliation_required = (outcome = 'contradictory_terminal'))
    `);
    await queryInterface.addIndex('psp_callback_audits', ['provider_id', 'psp_ref']);
    await queryInterface.addIndex('psp_callback_audits', ['deposit_id']);
  },

  async down(queryInterface) {
    await queryInterface.dropTable('psp_callback_audits');
  },
};
