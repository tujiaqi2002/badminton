-- Keep manager audit relationship lookups efficient as the manager directory grows.
create index manager_accounts_created_by_idx
  on private.manager_accounts (created_by)
  where created_by is not null;

create index manager_accounts_updated_by_idx
  on private.manager_accounts (updated_by)
  where updated_by is not null;
