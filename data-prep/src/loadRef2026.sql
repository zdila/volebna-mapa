-- Load the ŠÚ SR 2026 referendum open data (per-okrsok tables) into PostGIS.
-- Source: volby.statistics.sk/ref/ref2026/files/REF2026_SK_csv.zip
--   tab02e = per-okrsok turnout      -> ref2026_turnout
--   tab03f = per-okrsok answers (2 Q) -> ref2026_answers
--   tab0a  = the two question texts   -> ref2026_questions
-- Keyed by (obec_code, okrsok). Each Bratislava/Košice mestská časť is its own
-- obec in ŠÚ SR terms, matching our per-MČ okrsky_<mc> tables. All columns are
-- loaded as text (some cells may be empty) and cast at join time.
-- Run from data-prep/:  psql -d volebna -f src/loadRef2026.sql
\set ON_ERROR_STOP on

drop table if exists ref2026_turnout;
create table ref2026_turnout (
  kod_kraja text, nazov_kraja text, kod_obvod text, nazov_obvod text,
  kod_okres text, nazov_okres text, obec_code text, obec_name text,
  okrsok text, zapisani text, zucastneni text, ucast_pct text,
  obalky text, obalky_pct text, listky text, platne text);
\copy ref2026_turnout from 'data/ref2026/REF2026_SK_tab02e.csv' with (format csv, header true, encoding 'UTF8');

drop table if exists ref2026_answers;
create table ref2026_answers (
  kod_kraja text, nazov_kraja text, kod_obvod text, nazov_obvod text,
  kod_okres text, nazov_okres text, obec_code text, obec_name text,
  okrsok text, otazka text, ano text, ano_pct text, nie text, nie_pct text,
  neplatne text, neplatne_pct text);
\copy ref2026_answers from 'data/ref2026/REF2026_SK_tab03f.csv' with (format csv, header true, encoding 'UTF8');

drop table if exists ref2026_questions;
create table ref2026_questions (otazka text, znenie text);
\copy ref2026_questions from 'data/ref2026/REF2026_SK_tab0a.csv' with (format csv, header true, encoding 'UTF8');

create index if not exists ref2026_turnout_key on ref2026_turnout (obec_code, okrsok);
create index if not exists ref2026_answers_key on ref2026_answers (obec_code, okrsok);

select 'turnout rows' lbl, count(*) from ref2026_turnout
union all select 'answer rows', count(*) from ref2026_answers
union all select 'distinct obce', count(distinct obec_code) from ref2026_turnout;
