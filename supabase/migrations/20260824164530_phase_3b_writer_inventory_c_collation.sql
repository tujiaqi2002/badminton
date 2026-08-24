-- Make writer-inventory identity and ordering independent of the database's
-- default locale. pg_catalog-generated routine signatures use C collation;
-- the inventory must use the same bytewise semantics for array comparison and
-- stable fingerprints across isolated Supabase projects.

begin;

alter table private.reservation_phase3b_writer_inventory
  alter column signature type text collate pg_catalog."C"
  using signature::text;

comment on column private.reservation_phase3b_writer_inventory.signature is
  'Exact regprocedure signature using C collation for locale-independent inventory comparison and fingerprints.';

commit;
