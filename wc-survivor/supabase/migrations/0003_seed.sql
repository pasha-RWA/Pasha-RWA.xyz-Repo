-- ============================================================================
-- Seed: 48 teams, one contest, and its six rounds with deadlines.
-- Adjust the group draw, lock_at deadlines, and provider config to taste.
-- ============================================================================

insert into teams (id, name, flag, group_code, strength) values
  ('MEX','Mexico','🇲🇽','A',4),('CRO','Croatia','🇭🇷','A',4),('KSA','Saudi Arabia','🇸🇦','A',2),('HAI','Haiti','🇭🇹','A',1),
  ('CAN','Canada','🇨🇦','B',3),('NOR','Norway','🇳🇴','B',4),('CIV','Ivory Coast','🇨🇮','B',3),('UZB','Uzbekistan','🇺🇿','B',2),
  ('USA','United States','🇺🇸','C',4),('WAL','Wales','🏴󠁧󠁢󠁷󠁬󠁳󠁿','C',3),('EGY','Egypt','🇪🇬','C',3),('JOR','Jordan','🇯🇴','C',2),
  ('ARG','Argentina','🇦🇷','D',5),('AUS','Australia','🇦🇺','D',3),('NGA','Nigeria','🇳🇬','D',3),('PAN','Panama','🇵🇦','D',2),
  ('FRA','France','🇫🇷','E',5),('SUI','Switzerland','🇨🇭','E',4),('KOR','South Korea','🇰🇷','E',3),('NZL','New Zealand','🇳🇿','E',1),
  ('BRA','Brazil','🇧🇷','F',5),('JPN','Japan','🇯🇵','F',4),('SEN','Senegal','🇸🇳','F',3),('CRC','Costa Rica','🇨🇷','F',2),
  ('ENG','England','🏴󠁧󠁢󠁥󠁮󠁧󠁿','G',5),('DEN','Denmark','🇩🇰','G',4),('CMR','Cameroon','🇨🇲','G',3),('QAT','Qatar','🇶🇦','G',2),
  ('ESP','Spain','🇪🇸','H',5),('URU','Uruguay','🇺🇾','H',4),('GHA','Ghana','🇬🇭','H',3),('IRN','Iran','🇮🇷','H',2),
  ('POR','Portugal','🇵🇹','I',5),('COL','Colombia','🇨🇴','I',4),('ALG','Algeria','🇩🇿','I',3),('CUW','Curaçao','🇨🇼','I',1),
  ('NED','Netherlands','🇳🇱','J',5),('AUT','Austria','🇦🇹','J',3),('TUN','Tunisia','🇹🇳','J',2),('PAR','Paraguay','🇵🇾','J',3),
  ('GER','Germany','🇩🇪','K',5),('ECU','Ecuador','🇪🇨','K',3),('RSA','South Africa','🇿🇦','K',2),('SCO','Scotland','🏴󠁧󠁢󠁳󠁣󠁴󠁿','K',3),
  ('BEL','Belgium','🇧🇪','L',4),('POL','Poland','🇵🇱','L',3),('CPV','Cape Verde','🇨🇻','L',2),('HON','Honduras','🇭🇳','L',1)
on conflict (id) do nothing;

-- One contest. Set provider/comp/season once you have an API key (see README).
insert into contests (id, name, prize_pool, provider, provider_comp_id, provider_season)
values (
  '00000000-0000-0000-0000-0000000000c1',
  'WC 2026 Survivor — Pasha Office Pool',
  '$5,000',
  null,            -- 'football-data' or 'api-football' to enable live sync
  null,            -- competition id at the provider
  '2026'
) on conflict (id) do nothing;

-- Six rounds. lock_at = kickoff of the first match of that round (UTC).
-- These are the real FIFA World Cup 2026 schedule anchor dates — tweak as needed.
insert into rounds (contest_id, key, name, sort, pick_count, advance_count, lock_at, status) values
  ('00000000-0000-0000-0000-0000000000c1','GROUP','Group Stage',  0,4,32,'2026-06-11 16:00:00+00','open'),
  ('00000000-0000-0000-0000-0000000000c1','R32',  'Round of 32',  1,1,16,'2026-06-28 16:00:00+00','upcoming'),
  ('00000000-0000-0000-0000-0000000000c1','R16',  'Round of 16',  2,1, 8,'2026-07-04 16:00:00+00','upcoming'),
  ('00000000-0000-0000-0000-0000000000c1','QF',   'Quarterfinals',3,1, 4,'2026-07-09 16:00:00+00','upcoming'),
  ('00000000-0000-0000-0000-0000000000c1','SF',   'Semifinals',   4,1, 2,'2026-07-14 16:00:00+00','upcoming'),
  ('00000000-0000-0000-0000-0000000000c1','FINAL','Final',        5,1, 1,'2026-07-19 16:00:00+00','upcoming')
on conflict (contest_id, key) do nothing;
