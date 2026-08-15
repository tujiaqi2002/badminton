create index if not exists venue_member_tiers_updated_by_idx
  on public.venue_member_tiers (updated_by)
  where updated_by is not null;

create index if not exists venue_pricing_rules_member_tier_idx
  on public.venue_pricing_rules (member_tier)
  where member_tier is not null;
