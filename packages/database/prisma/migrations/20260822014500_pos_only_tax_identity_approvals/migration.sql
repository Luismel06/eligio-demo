-- The asynchronous approval workflow belongs exclusively to POS orders.
-- Requests created by the earlier preview for Customer/Supplier forms are
-- obsolete and may carry short-lived overrides that must not remain usable.
DELETE FROM "TaxIdentityApprovalRequest"
WHERE "contextType" <> 'POS_ORDER';

DELETE FROM "TaxIdentityOverride"
WHERE "contextType" <> 'POS_ORDER';

ALTER TABLE "TaxIdentityApprovalRequest"
ADD CONSTRAINT "TaxIdentityApprovalRequest_pos_order_only_check"
CHECK ("contextType" = 'POS_ORDER');

ALTER TABLE "TaxIdentityOverride"
ADD CONSTRAINT "TaxIdentityOverride_pos_order_only_check"
CHECK ("contextType" = 'POS_ORDER');
