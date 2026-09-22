-- =====================================================================
-- Modèle de programme : enseignement marocain (préscolaire -> lycée)
-- Code : 'ma_public'. Instancié par école via instantiate_curriculum_template().
--
-- NOTE : le fichier d'origine n'était pas fourni dans le dépôt ; ce modèle a été
-- reconstruit à partir de l'organisation officielle (cf. DECISIONS.md, D-002).
-- Arbre : cycle > niveau > filière > option. Les codes sont stables : ils servent
-- de clé aux heures par défaut (curriculum_template_hours.node_code).
-- =====================================================================

INSERT INTO curriculum_templates (code, name, country_code, tree)
VALUES ('ma_public', 'Programme marocain (MEN) — préscolaire au lycée', 'MA', $json$
[
  {"kind":"cycle","code":"PRESCO","name":"Préscolaire","name_ar":"التعليم الأولي","children":[
    {"kind":"level","code":"PRESCO_PS","name":"Petite section","name_ar":"القسم الصغير"},
    {"kind":"level","code":"PRESCO_MS","name":"Moyenne section","name_ar":"القسم المتوسط"},
    {"kind":"level","code":"PRESCO_GS","name":"Grande section","name_ar":"القسم الكبير"}
  ]},
  {"kind":"cycle","code":"PRIM","name":"Primaire","name_ar":"التعليم الابتدائي","children":[
    {"kind":"level","code":"PRIM_1","name":"1ère année primaire","name_ar":"السنة الأولى ابتدائي"},
    {"kind":"level","code":"PRIM_2","name":"2ème année primaire","name_ar":"السنة الثانية ابتدائي"},
    {"kind":"level","code":"PRIM_3","name":"3ème année primaire","name_ar":"السنة الثالثة ابتدائي"},
    {"kind":"level","code":"PRIM_4","name":"4ème année primaire","name_ar":"السنة الرابعة ابتدائي"},
    {"kind":"level","code":"PRIM_5","name":"5ème année primaire","name_ar":"السنة الخامسة ابتدائي"},
    {"kind":"level","code":"PRIM_6","name":"6ème année primaire","name_ar":"السنة السادسة ابتدائي"}
  ]},
  {"kind":"cycle","code":"COL","name":"Collège","name_ar":"التعليم الثانوي الإعدادي","children":[
    {"kind":"level","code":"COL_1","name":"1ère année collège","name_ar":"السنة الأولى إعدادي"},
    {"kind":"level","code":"COL_2","name":"2ème année collège","name_ar":"السنة الثانية إعدادي"},
    {"kind":"level","code":"COL_3","name":"3ème année collège","name_ar":"السنة الثالثة إعدادي"}
  ]},
  {"kind":"cycle","code":"LYC","name":"Lycée","name_ar":"التعليم الثانوي التأهيلي","children":[
    {"kind":"level","code":"LYC_TC","name":"Tronc commun","name_ar":"الجذع المشترك","children":[
      {"kind":"track","code":"LYC_TC_SC","name":"Tronc commun Sciences","name_ar":"الجذع المشترك العلمي"},
      {"kind":"track","code":"LYC_TC_LET","name":"Tronc commun Lettres et sciences humaines","name_ar":"الجذع المشترك للآداب والعلوم الإنسانية"}
    ]},
    {"kind":"level","code":"LYC_1BAC","name":"1ère année Bac","name_ar":"السنة الأولى باكالوريا","children":[
      {"kind":"track","code":"LYC_1BAC_SEXP","name":"Sciences expérimentales","name_ar":"العلوم التجريبية"},
      {"kind":"track","code":"LYC_1BAC_SM","name":"Sciences mathématiques","name_ar":"العلوم الرياضية"},
      {"kind":"track","code":"LYC_1BAC_ECO","name":"Sciences économiques et gestion","name_ar":"علوم الاقتصاد والتدبير"},
      {"kind":"track","code":"LYC_1BAC_LET","name":"Lettres et sciences humaines","name_ar":"الآداب والعلوم الإنسانية"}
    ]},
    {"kind":"level","code":"LYC_2BAC","name":"2ème année Bac","name_ar":"السنة الثانية باكالوريا","children":[
      {"kind":"track","code":"LYC_2BAC_SEXP","name":"Sciences expérimentales","name_ar":"العلوم التجريبية","children":[
        {"kind":"option","code":"LYC_2BAC_PC","name":"Sciences physiques","name_ar":"العلوم الفيزيائية"},
        {"kind":"option","code":"LYC_2BAC_SVT","name":"Sciences de la vie et de la terre","name_ar":"علوم الحياة والأرض"}
      ]},
      {"kind":"track","code":"LYC_2BAC_SM","name":"Sciences mathématiques","name_ar":"العلوم الرياضية","children":[
        {"kind":"option","code":"LYC_2BAC_SMA","name":"Sciences mathématiques A","name_ar":"العلوم الرياضية أ"},
        {"kind":"option","code":"LYC_2BAC_SMB","name":"Sciences mathématiques B","name_ar":"العلوم الرياضية ب"}
      ]},
      {"kind":"track","code":"LYC_2BAC_ECO","name":"Sciences économiques et gestion","name_ar":"علوم الاقتصاد والتدبير"},
      {"kind":"track","code":"LYC_2BAC_LET","name":"Lettres et sciences humaines","name_ar":"الآداب والعلوم الإنسانية"}
    ]}
  ]}
]
$json$::jsonb)
ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name, tree = EXCLUDED.tree;
