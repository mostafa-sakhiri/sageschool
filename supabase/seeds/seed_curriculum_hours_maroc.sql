-- =====================================================================
-- Heures hebdomadaires par défaut du modèle 'ma_public' (couverture PARTIELLE)
-- Appliquées à une année par apply_curriculum_template_hours().
--
-- NOTE : le fichier d'origine n'était pas fourni ; valeurs reconstruites comme
-- ordres de grandeur usuels (cf. DECISIONS.md, D-002). Rien n'est 'confirmed' :
--   proposed  = valeur courante, à faire confirmer par l'école
--   to_verify = valeur incertaine (lycée surtout)
-- Héritage : une ligne sur un cycle vaut pour tous ses niveaux ; un niveau peut
-- surcharger (autre valeur) ou retirer (0) une matière.
-- =====================================================================

INSERT INTO curriculum_template_hours
  (template_code, node_code, subject_code, subject_name, weekly_minutes,
   min_session_minutes, max_session_minutes, max_sessions_per_day, status, source)
VALUES
  -- Préscolaire (cycle entier)
  ('ma_public','PRESCO','LANG_AR','Langage arabe',            300, 30, 60, 1,'proposed','usage préscolaire'),
  ('ma_public','PRESCO','LANG_FR','Langage français',         300, 30, 60, 1,'proposed','usage préscolaire'),
  ('ma_public','PRESCO','LOGMATH','Activités logico-mathématiques',180, 30, 45, 1,'proposed','usage préscolaire'),
  ('ma_public','PRESCO','EVEIL','Éveil',                      120, 30, 60, 1,'proposed','usage préscolaire'),
  ('ma_public','PRESCO','ARTS','Activités artistiques',       180, 30, 60, 1,'proposed','usage préscolaire'),
  ('ma_public','PRESCO','EPS','Éducation physique',           120, 30, 60, 1,'proposed','usage préscolaire'),

  -- Primaire (cycle entier)
  ('ma_public','PRIM','ARA','Langue arabe',                   420, 45, 90, 2,'proposed','curriculum primaire'),
  ('ma_public','PRIM','FRA','Français',                       360, 45, 90, 2,'proposed','curriculum primaire'),
  ('ma_public','PRIM','MATH','Mathématiques',                 300, 45, 90, 1,'proposed','curriculum primaire'),
  ('ma_public','PRIM','ISL','Éducation islamique',            120, 45, 60, 1,'proposed','curriculum primaire'),
  ('ma_public','PRIM','EVS','Éveil scientifique',             120, 45, 60, 1,'proposed','curriculum primaire'),
  ('ma_public','PRIM','ARTS','Éducation artistique',           90, 45, 90, 1,'proposed','curriculum primaire'),
  ('ma_public','PRIM','EPS','Éducation physique',              90, 45, 90, 1,'proposed','curriculum primaire'),
  -- Primaire : matières qui n'arrivent qu'à certains niveaux
  ('ma_public','PRIM_3','ANG','Anglais',                       60, 30, 60, 1,'to_verify','généralisation progressive'),
  ('ma_public','PRIM_4','ANG','Anglais',                       60, 30, 60, 1,'to_verify','généralisation progressive'),
  ('ma_public','PRIM_5','ANG','Anglais',                       90, 45, 60, 1,'to_verify','généralisation progressive'),
  ('ma_public','PRIM_6','ANG','Anglais',                       90, 45, 60, 1,'to_verify','généralisation progressive'),
  ('ma_public','PRIM_5','SOC','Histoire-géographie',           90, 45, 90, 1,'proposed','curriculum primaire'),
  ('ma_public','PRIM_6','SOC','Histoire-géographie',           90, 45, 90, 1,'proposed','curriculum primaire'),

  -- Collège (cycle entier)
  ('ma_public','COL','ARA','Langue arabe',                    300, 60, 120, 1,'proposed','curriculum collège'),
  ('ma_public','COL','FRA','Français',                        360, 60, 120, 1,'proposed','curriculum collège'),
  ('ma_public','COL','ANG','Anglais',                         120, 60, 60, 1,'proposed','curriculum collège'),
  ('ma_public','COL','MATH','Mathématiques',                  300, 60, 120, 1,'proposed','curriculum collège'),
  ('ma_public','COL','PC','Physique-chimie',                  120, 60, 120, 1,'proposed','curriculum collège'),
  ('ma_public','COL','SVT','Sciences de la vie et de la terre',120, 60, 120, 1,'proposed','curriculum collège'),
  ('ma_public','COL','SOC','Histoire-géographie',             180, 60, 120, 1,'proposed','curriculum collège'),
  ('ma_public','COL','ISL','Éducation islamique',             120, 60, 60, 1,'proposed','curriculum collège'),
  ('ma_public','COL','EPS','Éducation physique',              120, 60, 120, 1,'proposed','curriculum collège'),
  ('ma_public','COL','INFO','Informatique',                    60, 60, 60, 1,'to_verify','curriculum collège'),

  -- Lycée : tronc commun (niveau), les filières surchargent
  ('ma_public','LYC_TC','ARA','Langue arabe',                 240, 60, 120, 1,'to_verify','curriculum lycée'),
  ('ma_public','LYC_TC','FRA','Français',                     240, 60, 120, 1,'to_verify','curriculum lycée'),
  ('ma_public','LYC_TC','ANG','Anglais',                      180, 60, 120, 1,'to_verify','curriculum lycée'),
  ('ma_public','LYC_TC','SOC','Histoire-géographie',          120, 60, 120, 1,'to_verify','curriculum lycée'),
  ('ma_public','LYC_TC','PHILO','Philosophie',                120, 60, 120, 1,'to_verify','curriculum lycée'),
  ('ma_public','LYC_TC','ISL','Éducation islamique',          120, 60, 60, 1,'to_verify','curriculum lycée'),
  ('ma_public','LYC_TC','EPS','Éducation physique',           120, 60, 120, 1,'to_verify','curriculum lycée'),
  ('ma_public','LYC_TC_SC','MATH','Mathématiques',            240, 60, 120, 1,'to_verify','curriculum lycée'),
  ('ma_public','LYC_TC_SC','PC','Physique-chimie',            240, 60, 120, 1,'to_verify','curriculum lycée'),
  ('ma_public','LYC_TC_SC','SVT','Sciences de la vie et de la terre',180, 60, 120, 1,'to_verify','curriculum lycée'),
  ('ma_public','LYC_TC_LET','MATH','Mathématiques',           120, 60, 120, 1,'to_verify','curriculum lycée'),
  ('ma_public','LYC_TC_LET','ARA','Langue arabe',             300, 60, 120, 1,'to_verify','curriculum lycée')
  -- 1ère et 2ème Bac : pas encore couverts (couverture partielle assumée)
ON CONFLICT (template_code, node_code, subject_code) DO UPDATE
  SET subject_name = EXCLUDED.subject_name, weekly_minutes = EXCLUDED.weekly_minutes,
      min_session_minutes = EXCLUDED.min_session_minutes,
      max_session_minutes = EXCLUDED.max_session_minutes,
      max_sessions_per_day = EXCLUDED.max_sessions_per_day,
      status = EXCLUDED.status, source = EXCLUDED.source;
