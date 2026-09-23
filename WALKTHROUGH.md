# Walkthrough — boucle complète sur une école neuve

Généré par `node scripts/walkthrough.mjs` le 2026-09-23T21:04:50.953Z (run `mueld0nj`).
Chaque étape s'exécute **connecté en tant que l'utilisateur réel** (directeur, secrétariat, professeurs, parents, élève) via Supabase Auth : les droits appliqués sont ceux de la RLS, comme dans l'interface.
Seule la création des comptes reproduit la fonction serveur `inviteMember` (clé secrète après vérification du rôle).

**Résultat : toutes les vérifications passent ✅**

### 0. Le fondateur crée son compte

- ✅ compte directeur.mueld0nj@walkthrough.test créé et connecté (Supabase Auth, profil public.users lié par trigger)

### 1. École → année scolaire → arbre du programme

- ✅ école créée (3ec07ad8-865a-4e50-96cf-07120abb3fbb) — le créateur est admin
- ✅ arbre instancié : 11 nœuds (Préscolaire 3 + Primaire 6 + 2 cycles)
- ✅ année 2026-2027 en cours ; 27 lignes d'horaires par défaut appliquées (statut « proposé »)
- ✅ 27 horaires confirmés par l'école

### 2. L'équipe : professeurs et secrétariat

- ✅ 2 professeurs + 1 secrétaire ajoutés avec leur rôle

### 3. Classes sous les nœuds + horaires par défaut

- ✅ 1ère A hérite de 7 matières, 25 h/semaine (horaires du nœud « 1ère année primaire »)
- ✅ attribution : Maths 1ère A → Nadia ; Arabe 1ère A et Maths 2ème A → Youssef

### 4. Élèves + parents (fratrie)

- ✅ 3 élèves inscrits par le secrétariat (Yasmine en 1ère A ; Adam et Omar en 2ème A)
- ✅ Fatima liée à Yasmine ET Adam (fratrie) ; Karim lié à Omar
- ✅ accès élève activé pour Yasmine (students.member_id → membre « student »)

### 5. Emploi du temps versionné d'une classe + publication

- ✅ créneau qui chevauche refusé par la base
- ✅ avant publication : le brouillon est invisible pour le professeur
- ✅ version « Rentrée 2026 » publiée (3 séances)
- ✅ professeur déjà en cours ailleurs : double réservation refusée

### 6. Une exception d'un jour (absence du prof → remplaçant)

- ✅ le 05/10 la séance de maths est « changed », assurée par Youssef ; la trame reste intacte
- ✅ le lundi suivant, Nadia reprend (exception d'un seul jour)

### 7. Annonce ciblée sur un nœud + vérification RLS

- ✅ publiée ; 1 message WhatsApp simulé (Fatima seulement : enfant en 1ère A)
- ✅ Fatima (enfant sous « 1ère année primaire ») voit l'annonce
- ✅ Karim (enfant en 2ème année) ne la voit pas — RLS

### 8. Échéances + paiement partiel + statut

- ✅ statut calculé : partial, payé 600, reste 900
- ✅ Fatima ne voit que l'échéance de ses enfants (pas celle d'Omar)

### Phase 3 · Absences : le prof fait l'appel, parent et élève voient

- ✅ re-saisir l'appel met à jour (pas de doublon) : « late »
- ✅ Nadia ne peut pas faire l'appel en 2ème A (pas sa classe)
- ✅ Youssef voit ses 2 classes (1ère A, 2ème A)
- ✅ Nadia ne voit que la 1ère A
- ✅ Fatima voit le retard de Yasmine
- ✅ Fatima justifie → « excused »
- ✅ Karim ne voit aucune absence de Yasmine

### Phase 3 · Accès élève (lecture seule)

- ✅ l'élève ne voit que sa propre fiche
- ✅ l'élève lit l'emploi du temps publié de sa classe (3 séances)
- ✅ l'élève lit ses propres absences
- ✅ l'élève voit le devoir de sa classe
- ✅ l'élève ne peut rien écrire (devoir refusé)
- ✅ l'élève ne voit pas la scolarité

### Phase 3 · Réclamation : parent → secrétariat → réponse → clôture

- ✅ Fatima ouvre un échange « Transport scolaire »
- ✅ Karim ne voit pas l'échange de Fatima
- ✅ la réponse du secrétariat passe l'échange en « answered »
- ✅ Fatima voit la réponse dans le fil
- ✅ notification WhatsApp de la réponse consignée (envoi simulé)
- ✅ échange clôturé : plus de message possible

### Isolation entre écoles

- ✅ l'admin d'une autre école (Les Lauréats) lit 0 élève de cette école
