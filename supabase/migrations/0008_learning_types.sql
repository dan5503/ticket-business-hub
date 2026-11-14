-- Learning Center: event types (concerts / comedy / theater & shows / sports / parking), sport kind,
-- and "big names vs smaller finds" (artists PLT tracks vs everything else).

create table if not exists public.event_type_overrides (
  artist text primary key,           -- matched case-insensitively against the start of the event name
  type   text not null,              -- Concerts | Comedy | Theater & shows | Sports | Parking
  sport  text
);
alter table public.event_type_overrides enable row level security;
drop policy if exists "read overrides" on public.event_type_overrides;
create policy "read overrides" on public.event_type_overrides for select to authenticated using (true);

create or replace function public.event_category(a text)
returns text[] language sql immutable set search_path to 'public' as $$
  select case
    when a is null then array['Concerts', null]
    when a ~* '\mparking\M' then array['Parking', null]
    -- concerts that carry sporty or show-y words
    when a ~* '(houston rodeo -|jingle ball|concert for legends|summerfest|concert series|music showcase|tribute)' then array['Concerts', null]
    -- sports
    when a ~* '(world cup|\mwc26\M|fifa|\mmls\M|premier league|copa )' then array['Sports', 'Soccer']
    when a ~* '(tennis|\matp\M|\mwta\M)' then array['Sports', 'Tennis']
    when a ~* '(beanpot|\mnhl\M|stanley cup|hockey|bruins|rangers at|islanders|devils|flyers|penguins|capitals|maple leafs|canadiens|oilers|flames|canucks|blackhawks|red wings|lightning|panthers at|avalanche|golden knights|kraken|predators|hurricanes|blue jackets|senators|sabres|wild at|stars at|ducks at|sharks|utah hockey)' then array['Sports', 'Hockey']
    when a ~* '(\mnba\M|\mwnba\M|knicks|spurs|cavaliers|wizards|lakers|celtics|warriors|heat at|at miami heat|bulls|nets at|at brooklyn nets|76ers|bucks|nuggets|suns at|at phoenix suns|mavericks|thunder at|at oklahoma city thunder|timberwolves|pacers|hawks at|at atlanta hawks|hornets|pistons|raptors|magic at|at orlando magic|grizzlies|pelicans|clippers|trail blazers|jazz at|at utah jazz|rockets at|at houston rockets|kings at|at sacramento kings|liberty at|at new york liberty|fever|aces at|sky at)' then array['Sports', 'Basketball']
    when a ~* '(\mnfl\M|\mafc\M|\mnfc\M|super bowl|patriots|broncos|cowboys|eagles|steelers|chiefs|packers|bears at|at chicago bears|49ers|seahawks|ravens|bengals|browns|bills at|at buffalo bills|dolphins|jets at|at new york jets|giants at|at new york giants|commanders|saints|buccaneers|falcons|lions at|at detroit lions|vikings|texans|colts|jaguars|titans|raiders|chargers|rams at|at los angeles rams|cardinals at|at arizona cardinals)' then array['Sports', 'Football']
    when a ~* '(\mmlb\M|world series|dodgers|braves|guardians|yankees|mets at|at new york mets|red sox|cubs|white sox|phillies|astros|mariners|padres|brewers|pirates|reds at|at cincinnati reds|orioles|rays at|at tampa bay rays|blue jays|tigers at|at detroit tigers|twins|royals|angels at|at los angeles angels|athletics|marlins|nationals|rockies|diamondbacks)' then array['Sports', 'Baseball']
    when a ~* '(\mncaa\M|march madness|final four|bowl game|college football)' then array['Sports', 'College']
    when a ~* '(\mufc\M|boxing|\mwwe\M|\maew\M|fight night|wrestlemania|\mpfl\M)' then array['Sports', 'Fighting & wrestling']
    when a ~* '(rodeo|bull riders|\mpbr\M)' then array['Sports', 'Rodeo']
    when a ~* '(nascar|grand prix|\mf1\M|indycar|supercross|monster jam|monster truck)' then array['Sports', 'Motorsports']
    when a ~* '(\mpga\M|\mlpga\M|golf|ryder cup|masters)' then array['Sports', 'Golf']
    when a ~* '(league of legends|esports|valorant|overwatch|call of duty league)' then array['Sports', 'Esports']
    when a ~* '(viewing party|match viewing|watch party)' then array['Sports', 'Other sports']
    when a ~ '^[A-Z][A-Za-z.''& ]+ (at|vs\.?) [A-Z][A-Za-z.''& ]+$' then array['Sports', 'Other sports']
    -- theater & shows
    when a ~* '(broadway|musical|mamma mia|hamilton|wicked|lion king|les mis|phantom of|book of mormon|hadestown|moulin rouge|dancing with the stars|in conversation|neil degrasse|theresa caputo|cirque|on ice|ballet|nutcracker|opera\M|in concert|symphony|illusionist|magician|podcast|kiriakou|harry potter|chicago the musical|six the musical|beetlejuice|mrs\. doubtfire|a christmas carol|blue man)' then array['Theater & shows', null]
    -- comedy
    when a ~* '(comedy|comedian|joke|roast of|stand-?up|laugh|\(18\+ event\)|\(16\+ event\)|seinfeld|matt rife|shane gillis|chappelle|matt mathews|mojo brookzz|marcello hernandez|jimmy carr|adam ray|jeff dunham|gabriel iglesias|jo koy|martin lawrence|daniel tosh|tom papa|ali siddiq|nurse john|brad williams|gianmarco soresi|daniel sloss|bassem youssef|yohay sponder|stavros halkias|morgan jay|nikki glaser|hablando huevadas|kevin hart|bert kreischer|tom segura|maniscalco|theo von|andrew schulz|taylor tomlinson|ricky gervais|bill burr|leanne morgan|nate bargatze|mulaney|gaffigan|trevor noah|chris rock|katt williams|mark normand|sam morril|ronny chieng|hasan minhaj|fortune feimster|iliza|whitney cummings|bobby lee|andrew santino|tim dillon|ms\. pat|jeff foxworthy|larry the cable guy|jim jefferies|anjelah johnson|ralph barbosa|druski|killer beaz|dusty slay|caleb pressley|zarna garg|laura ramoso)' then array['Comedy', null]
    else array['Concerts', null]
  end
$$;

-- "big name" key: event name without (notes), "Parking", "- 2 Day Pass" etc.
create or replace function public.artist_key(a text)
returns text language sql immutable as $$
  select lower(btrim(regexp_replace(regexp_replace(coalesce(a,''), '\s*\([^)]*\)', '', 'g'), '\s+(parking|- \d+ day pass.*)$', '', 'i')))
$$;

drop function if exists public.learning_center(text, date, date, text, text, text, text);

create or replace function public.learning_center(
  p_book text default 'mine', p_from date default null, p_to date default null,
  p_artist text default null, p_city text default null, p_tier text default null, p_price text default null,
  p_type text default null, p_sport text default null, p_fame text default null)
returns jsonb language sql stable set search_path to 'public' as $function$
with plt_names as materialized (
  select distinct public.artist_key(artist) k from public.plt_sales_clean where not coalesce(is_repost,false)
), dups as materialized (
  select pl.id from public.plt_sales_clean pl join public.sales s on s.artist = pl.artist and s.event_date = pl.event_date
   and s.section is not distinct from pl.section and s.row_name is not distinct from pl.row_name
   and s.quantity is not distinct from pl.quantity and s.total_sale is not distinct from pl.total_sale
  where p_book = 'both'
), base as (
  select artist, venue, city, upper(coalesce(section,'')) sec, upper(coalesce(row_name,'')) rw,
         greatest(coalesce(quantity,1),1) q, total_cost c, profit p, cost_per, purchase_date, event_date, sold_date
  from public.sales where p_book in ('mine','both')
  union all
  select artist, venue, city, upper(coalesce(section,'')), upper(coalesce(row_name,'')),
         greatest(coalesce(quantity,1),1), total_cost, profit, cost_per, purchase_date, event_date, sold_date
  from public.plt_sales_clean pl where p_book in ('plt','both') and not coalesce(pl.is_repost,false)
    and pl.id not in (select id from dups)
), arts as materialized (
  select d.artist,
         case when o.type is not null then array[o.type, o.sport] else public.event_category(d.artist) end ec,
         public.artist_key(d.artist) in (select k from plt_names) big
  from (select distinct coalesce(artist, '') artist from base) d
  left join lateral (select type, sport from public.event_type_overrides o
                     where lower(d.artist) like lower(o.artist) || '%' order by length(o.artist) desc limit 1) o on true
), cat as (
  select b.*, coalesce(a.ec, array['Concerts', null]) ec,
         case when a.big then 'Big names (PLT tracks them)' else 'Your finds (not in PLT)' end fame
  from base b left join arts a on coalesce(a.artist, '') = coalesce(b.artist, '')
), x as (
  select b.*, ec[1] etype, coalesce(ec[2], case when ec[1] = 'Sports' then 'Other sports' end) sport,
    case
      when sec ~ '(SUITE|BOX|LOGE|VIP|PREMIUM|CABANA)' then 'Suites & VIP'
      when sec ~ 'PIT' then 'Pit'
      when sec ~ 'LAWN' then 'Lawn'
      when sec ~ '(FLOOR|FLR|GA\M|GENADM|GENERAL|STANDING)' or sec ~ '^F[0-9A-Z]?$' then 'Floor / GA'
      when sec ~ 'ORCH' then 'Orchestra'
      when sec ~ '(MEZZ|DRESS CIRCLE)' then 'Mezzanine'
      when sec ~ 'BALC' then 'Balcony'
      when sec ~ '(CLUB)' then 'Club'
      when sec ~ '(LOWER|LWR|PLAZA|FIELD)' then 'Lower level'
      when sec ~ '(UPPER|UPR|TERRACE|GRANDSTAND)' then 'Upper level'
      when substring(sec from '(\d+)') is not null then
        case when substring(sec from '(\d+)')::int between 100 and 199 then 'Lower level (100s)'
             when substring(sec from '(\d+)')::int between 200 and 299 then 'Middle level (200s)'
             when substring(sec from '(\d+)')::int >= 300 then 'Upper level (300s+)'
             else 'Sections 1–99' end
      else 'Other' end tier,
    case when cost_per is null then 'Unknown'
         when cost_per < 50 then 'Under $50' when cost_per < 100 then '$50–99' when cost_per < 150 then '$100–149'
         when cost_per < 250 then '$150–249' when cost_per < 400 then '$250–399' when cost_per < 700 then '$400–699'
         else '$700+' end pb,
    case when cost_per is null then 99 when cost_per < 50 then 1 when cost_per < 100 then 2 when cost_per < 150 then 3
         when cost_per < 250 then 4 when cost_per < 400 then 5 when cost_per < 700 then 6 else 7 end pbo,
    case when purchase_date is null or event_date is null then 'Unknown'
         when event_date - purchase_date < 7 then 'Under a week' when event_date - purchase_date < 30 then '1–4 weeks'
         when event_date - purchase_date < 90 then '1–3 months' when event_date - purchase_date < 180 then '3–6 months'
         else '6+ months' end lead,
    case when purchase_date is null or event_date is null then 9 when event_date - purchase_date < 7 then 1
         when event_date - purchase_date < 30 then 2 when event_date - purchase_date < 90 then 3
         when event_date - purchase_date < 180 then 4 else 5 end leado,
    case when rw = '' or rw ~ '(GA|GEN|ADM|LAWN)' then 'GA / no row'
         when rw ~ '^\d+$' then case when rw::int <= 5 then 'Rows 1–5' when rw::int <= 10 then 'Rows 6–10' when rw::int <= 20 then 'Rows 11–20' else 'Row 21+' end
         when rw ~ '^[A-Z]$' then case when ascii(rw) - 64 <= 5 then 'Rows 1–5' when ascii(rw) - 64 <= 10 then 'Rows 6–10' when ascii(rw) - 64 <= 20 then 'Rows 11–20' else 'Row 21+' end
         when rw ~ '^[A-Z]{2}$' then 'Row 21+'
         else 'Other' end rowb,
    case when q >= 5 then '5+ tickets' else q || (case when q = 1 then ' ticket' else ' tickets' end) end qb,
    to_char(event_date, 'Dy') ewd, extract(isodow from event_date)::int ewdo,
    (sold_date - purchase_date) dts
  from cat b
  where (p_from is null or sold_date >= p_from) and (p_to is null or sold_date <= p_to)
), f as (
  select * from x
  where (p_artist is null or artist ilike '%' || p_artist || '%')
    and (p_city is null or city = p_city)
    and (p_tier is null or tier = p_tier)
    and (p_price is null or pb = p_price)
    and (p_type is null or etype = p_type)
    and (p_sport is null or sport = p_sport)
    and (p_fame is null or fame = p_fame)
)
select jsonb_build_object(
  'overall', (select jsonb_build_object('n', count(*), 't', coalesce(sum(q),0), 'cost', coalesce(sum(c),0), 'profit', coalesce(sum(p),0),
      'roi', sum(p) / nullif(sum(c),0), 'win', avg((p > 0)::int), 'loss', avg((p < 0)::int), 'ppt', sum(p) / nullif(sum(q),0),
      'dts', percentile_cont(.5) within group (order by dts)) from f),
  'tier',  (select coalesce(jsonb_agg(g order by g->>'k'), '[]') from (select jsonb_build_object('k', tier, 'n', count(*), 't', sum(q), 'cost', sum(c), 'profit', sum(p), 'roi', sum(p)/nullif(sum(c),0), 'win', avg((p>0)::int), 'ppt', sum(p)/nullif(sum(q),0), 'dts', percentile_cont(.5) within group (order by dts)) g from f group by tier) s),
  'price', (select coalesce(jsonb_agg(g order by (g->>'o')::int), '[]') from (select jsonb_build_object('k', pb, 'o', min(pbo), 'n', count(*), 't', sum(q), 'cost', sum(c), 'profit', sum(p), 'roi', sum(p)/nullif(sum(c),0), 'win', avg((p>0)::int), 'ppt', sum(p)/nullif(sum(q),0), 'dts', percentile_cont(.5) within group (order by dts)) g from f group by pb) s),
  'lead',  (select coalesce(jsonb_agg(g order by (g->>'o')::int), '[]') from (select jsonb_build_object('k', lead, 'o', min(leado), 'n', count(*), 't', sum(q), 'cost', sum(c), 'profit', sum(p), 'roi', sum(p)/nullif(sum(c),0), 'win', avg((p>0)::int), 'ppt', sum(p)/nullif(sum(q),0), 'dts', percentile_cont(.5) within group (order by dts)) g from f group by lead) s),
  'row',   (select coalesce(jsonb_agg(g order by g->>'k'), '[]') from (select jsonb_build_object('k', rowb, 'n', count(*), 't', sum(q), 'cost', sum(c), 'profit', sum(p), 'roi', sum(p)/nullif(sum(c),0), 'win', avg((p>0)::int), 'ppt', sum(p)/nullif(sum(q),0), 'dts', percentile_cont(.5) within group (order by dts)) g from f group by rowb) s),
  'qty',   (select coalesce(jsonb_agg(g order by g->>'k'), '[]') from (select jsonb_build_object('k', qb, 'n', count(*), 't', sum(q), 'cost', sum(c), 'profit', sum(p), 'roi', sum(p)/nullif(sum(c),0), 'win', avg((p>0)::int), 'ppt', sum(p)/nullif(sum(q),0), 'dts', percentile_cont(.5) within group (order by dts)) g from f group by qb) s),
  'weekday', (select coalesce(jsonb_agg(g order by (g->>'o')::int), '[]') from (select jsonb_build_object('k', ewd, 'o', min(ewdo), 'n', count(*), 't', sum(q), 'cost', sum(c), 'profit', sum(p), 'roi', sum(p)/nullif(sum(c),0), 'win', avg((p>0)::int), 'ppt', sum(p)/nullif(sum(q),0), 'dts', percentile_cont(.5) within group (order by dts)) g from f where ewd is not null group by ewd) s),
  'etype', (select coalesce(jsonb_agg(g order by (g->>'n')::int desc), '[]') from (select jsonb_build_object('k', etype, 'n', count(*), 't', sum(q), 'cost', sum(c), 'profit', sum(p), 'roi', sum(p)/nullif(sum(c),0), 'win', avg((p>0)::int), 'ppt', sum(p)/nullif(sum(q),0), 'dts', percentile_cont(.5) within group (order by dts)) g from f group by etype) s),
  'sport', (select coalesce(jsonb_agg(g order by (g->>'n')::int desc), '[]') from (select jsonb_build_object('k', sport, 'n', count(*), 't', sum(q), 'cost', sum(c), 'profit', sum(p), 'roi', sum(p)/nullif(sum(c),0), 'win', avg((p>0)::int), 'ppt', sum(p)/nullif(sum(q),0), 'dts', percentile_cont(.5) within group (order by dts)) g from f where sport is not null group by sport) s),
  'fame',  (select coalesce(jsonb_agg(g order by g->>'k'), '[]') from (select jsonb_build_object('k', fame, 'n', count(*), 't', sum(q), 'cost', sum(c), 'profit', sum(p), 'roi', sum(p)/nullif(sum(c),0), 'win', avg((p>0)::int), 'ppt', sum(p)/nullif(sum(q),0), 'dts', percentile_cont(.5) within group (order by dts)) g from f group by fame) s),
  'fame_artists', (select coalesce(jsonb_agg(g order by (g->>'n')::int desc), '[]') from (select jsonb_build_object('k', artist, 'n', count(*), 't', sum(q), 'cost', sum(c), 'profit', sum(p), 'roi', sum(p)/nullif(sum(c),0), 'win', avg((p>0)::int), 'ppt', sum(p)/nullif(sum(q),0), 'dts', percentile_cont(.5) within group (order by dts)) g from f where fame like 'Your finds%' and etype <> 'Parking' group by artist order by count(*) desc limit 40) s),
  'city',  (select coalesce(jsonb_agg(g order by (g->>'n')::int desc), '[]') from (select jsonb_build_object('k', city, 'n', count(*), 't', sum(q), 'cost', sum(c), 'profit', sum(p), 'roi', sum(p)/nullif(sum(c),0), 'win', avg((p>0)::int), 'ppt', sum(p)/nullif(sum(q),0), 'dts', percentile_cont(.5) within group (order by dts)) g from f where city is not null and city <> '' group by city order by count(*) desc limit 60) s),
  'venue', (select coalesce(jsonb_agg(g order by (g->>'n')::int desc), '[]') from (select jsonb_build_object('k', venue, 'n', count(*), 't', sum(q), 'cost', sum(c), 'profit', sum(p), 'roi', sum(p)/nullif(sum(c),0), 'win', avg((p>0)::int), 'ppt', sum(p)/nullif(sum(q),0), 'dts', percentile_cont(.5) within group (order by dts)) g from f where venue is not null group by venue order by count(*) desc limit 60) s),
  'artist',(select coalesce(jsonb_agg(g order by (g->>'n')::int desc), '[]') from (select jsonb_build_object('k', artist, 'n', count(*), 't', sum(q), 'cost', sum(c), 'profit', sum(p), 'roi', sum(p)/nullif(sum(c),0), 'win', avg((p>0)::int), 'ppt', sum(p)/nullif(sum(q),0), 'dts', percentile_cont(.5) within group (order by dts)) g from f where artist is not null group by artist order by count(*) desc limit 60) s),
  'matrix',(select coalesce(jsonb_agg(g), '[]') from (select jsonb_build_object('tier', tier, 'price', pb, 'o', min(pbo), 'n', count(*), 'profit', sum(p), 'roi', sum(p)/nullif(sum(c),0), 'win', avg((p>0)::int), 'ppt', sum(p)/nullif(sum(q),0)) g from f group by tier, pb) s),
  'combos',(select coalesce(jsonb_agg(g), '[]') from (select jsonb_build_object('tier', tier, 'price', pb, 'lead', lead, 'n', count(*), 'profit', sum(p), 'roi', sum(p)/nullif(sum(c),0), 'win', avg((p>0)::int), 'ppt', sum(p)/nullif(sum(q),0)) g from f where pb <> 'Unknown' and lead <> 'Unknown' group by tier, pb, lead having count(*) >= 12) s),
  'cities', (select coalesce(jsonb_agg(distinct city), '[]') from x where city is not null and city <> ''),
  'tiers',  (select coalesce(jsonb_agg(distinct tier), '[]') from x),
  'types',  (select coalesce(jsonb_agg(distinct etype), '[]') from x),
  'sports', (select coalesce(jsonb_agg(distinct sport), '[]') from x where sport is not null)
) $function$;

grant execute on function public.learning_center(text, date, date, text, text, text, text, text, text, text) to authenticated;
