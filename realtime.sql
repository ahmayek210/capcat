-- Add only Capcat tables to the existing Realtime publication.
do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'capcat_profiles') then
    alter publication supabase_realtime add table public.capcat_profiles;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'capcat_cats') then
    alter publication supabase_realtime add table public.capcat_cats;
  end if;
end $$;
