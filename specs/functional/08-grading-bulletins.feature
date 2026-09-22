\# maps to: assessments, grades, report_cards
\# depends on: Timetabling (teacher_subjects — who may grade what), Enrollment & Re-enrollment
\#             (students), Academic Structure Setup (classes, subjects, academic_years)
\# depended on by: MASSAR Sync (report_cards.massar_sync_status), Communication (AI comment
\#                 delivery to parents)

Feature: Grading & Bulletins
  As a teacher or school administrator
  I want to record assessments and grades, and generate report cards with AI-assisted comments
  So that bulletins are accurate, on time, and MASSAR-ready — without triple data entry

  Background:
    Given the school "École Al Amal - Campus Principal" exists
    And the academic year "2026-2027" is current for the school
    And the class "CP1-A" exists for "2026-2027" with 2 enrolled students: "Rania Idrissi" and "Omar Tahiri"
    And the subject "Mathématiques" exists with default_coefficient 4
    And "Nadia Fassi" teaches "Mathématiques" in "CP1-A"

  # ---------------------------------------------------------------
  # Assessments
  # ---------------------------------------------------------------

  @grading @teacher
  Scenario: Create a continuous-assessment (contrôle continu) evaluation
    When "Nadia Fassi" creates an assessment with:
      | class               | CP1-A         |
      | subject             | Mathématiques  |
      | term                | 1               |
      | assessment_type     | cc               |
      | name                | Contrôle 1        |
      | max_score           | 20                 |
      | coefficient         | 1                   |
      | assessment_date     | 2026-10-10           |
    Then the assessment "Contrôle 1" should exist for "CP1-A" / "Mathématiques" / term 1

  @grading
  Scenario: Reject an assessment with an invalid term
    When "Nadia Fassi" attempts to create an assessment with term 4
    Then the creation should fail with a validation error

  @grading
  Scenario: Reject an assessment with an invalid assessment_type
    When "Nadia Fassi" attempts to create an assessment with assessment_type "quiz"
    Then the creation should fail with a validation error

  @grading @security
  Scenario: A teacher can only create assessments for classes/subjects they are assigned to teach
    Given "Nadia Fassi" is NOT assigned to teach "Sciences" in "CP1-A"
    When "Nadia Fassi" attempts to create an assessment for "Sciences" in "CP1-A"
    Then the creation should be rejected
    And the system should indicate she is not assigned to that subject for that class

  # ---------------------------------------------------------------
  # Grade entry
  # ---------------------------------------------------------------

  @grading @teacher
  Scenario: Enter a grade for a student
    Given the assessment "Contrôle 1" exists for "CP1-A" / "Mathématiques" / term 1
    When "Nadia Fassi" enters a score of 15.5 for "Rania Idrissi" on "Contrôle 1"
    Then a grade record should exist linking "Rania Idrissi" to "Contrôle 1" with score 15.5

  @grading
  Scenario: Reject a score above the assessment's max_score
    Given the assessment "Contrôle 1" has max_score 20
    When "Nadia Fassi" attempts to enter a score of 24 for "Rania Idrissi"
    Then the entry should fail with a validation error

  @grading
  Scenario: Re-entering a grade updates it instead of creating a duplicate
    Given "Rania Idrissi" already has a score of 15.5 on "Contrôle 1"
    When "Nadia Fassi" enters a new score of 16 for "Rania Idrissi" on "Contrôle 1"
    Then the existing grade record should be updated to 16
    And no duplicate grade record should be created

  @grading @teacher
  Scenario: Bulk grade entry for an entire class in one action
    Given the assessment "Contrôle 1" exists for "CP1-A"
    When "Nadia Fassi" enters grades for all enrolled students in "CP1-A" in a single bulk action
    Then a grade record should exist for every actively enrolled student in "CP1-A" for "Contrôle 1"

  @grading @security
  Scenario: Reject a grade for a student not enrolled in the assessment's class
    Given "Omar Tahiri" is enrolled in a different class "CP1-B"
    And the assessment "Contrôle 1" belongs to "CP1-A"
    When "Nadia Fassi" attempts to enter a grade for "Omar Tahiri" on "Contrôle 1"
    Then the entry should fail with a validation error

  # ---------------------------------------------------------------
  # Averages
  # ---------------------------------------------------------------

  @grading
  Scenario: Compute a student's subject average for a term, weighted by assessment coefficient
    Given "Rania Idrissi" has the following grades in "Mathématiques" for term 1:
      | assessment    | score | coefficient |
      | Contrôle 1    | 16    | 1           |
      | Contrôle 2    | 12    | 1           |
      | Examen        | 14    | 2           |
    When the subject average is computed
    Then the result should be the coefficient-weighted average: (16*1 + 12*1 + 14*2) / 4 = 14

  @grading
  Scenario: Compute a student's general average across subjects, weighted by subject coefficient
    Given "Rania Idrissi" has a term-1 average of 14 in "Mathématiques" (coefficient 4)
    And a term-1 average of 16 in "Français" (coefficient 3)
    When the general average is computed
    Then the result should be (14*4 + 16*3) / 7 ≈ 14.86

  @grading
  Scenario: A subject with no grades entered is excluded from the average, not treated as zero
    Given "Omar Tahiri" has grades in "Mathématiques" but none yet in "Sciences" for term 1
    When the general average is computed
    Then "Sciences" should be excluded from the calculation, not counted as a 0
    And the missing-grades flag described below should still block report card generation

  # ---------------------------------------------------------------
  # Report card generation — the MASSAR-critical gate
  # ---------------------------------------------------------------

  @grading @massar @blocking
  Scenario: Block report card generation until every subject has grades entered
    Given "CP1-A" has 6 subjects for term 1
    And "Rania Idrissi" has grades entered in 5 of the 6 subjects
    When someone attempts to generate "Rania Idrissi"'s term-1 report card
    Then the generation should fail
    And the system should list "Sciences" as the missing subject blocking generation
    Note: mirrors MASSAR's own rule — a single missing grade blocks the entire bulletin

  @grading
  Scenario: Generate a report card once all subject grades are complete
    Given "Rania Idrissi" has grades entered in all 6 subjects for term 1
    When a secretary generates "Rania Idrissi"'s term-1 report card
    Then a report_cards record should be created with the computed general_average
    And massar_sync_status should be "pending"

  @grading
  Scenario: Reject generating a duplicate report card for the same student, year, and term
    Given a report card already exists for "Rania Idrissi" for term 1 of "2026-2027"
    When someone attempts to generate another report card for the same student, year, and term
    Then the system should update the existing report card instead of creating a duplicate

  # ---------------------------------------------------------------
  # AI-generated comments (human-in-the-loop)
  # ---------------------------------------------------------------

  @grading @ai
  Scenario: AI drafts a bilingual comment when the report card is generated
    Given "Rania Idrissi"'s term-1 report card is being generated with a general_average of 14.86
    When the AI comment generator runs
    Then ai_generated_comment should be populated in French and Arabic
    And it should be based on the student's actual grades, attendance, and any teacher notes
    And teacher_comment should remain empty until a human reviews it

  @grading @ai @teacher
  Scenario: A teacher must approve or edit the AI draft before it appears on the final bulletin
    Given "Rania Idrissi"'s report card has an ai_generated_comment drafted
    When "Nadia Fassi" reviews the draft and either approves it as-is or edits it
    Then teacher_comment should be set to the approved/edited text
    And only teacher_comment, never the raw ai_generated_comment, should print on the PDF bulletin

  @grading @ai
  Scenario: The AI draft is never sent to a parent without human approval
    Given a report card has only ai_generated_comment populated and no teacher_comment
    When the system attempts to notify parents that bulletins are ready
    Then that report card should be excluded from the notification batch until teacher_comment is set

  # ---------------------------------------------------------------
  # PDF & MASSAR readiness
  # ---------------------------------------------------------------

  @grading
  Scenario: Generate the bulletin PDF once the teacher comment is approved
    Given "Rania Idrissi"'s report card has teacher_comment approved
    When the PDF generation job runs
    Then pdf_url should be populated
    And the bulletin should be downloadable by the school and the parent

  @grading @massar
  Scenario: A confirmed report card is ready for MASSAR export
    Given "Rania Idrissi"'s report card has teacher_comment approved and pdf_url populated
    When the report card is submitted for MASSAR export
    Then massar_sync_status should move from "pending" to "exported"
    Note: the export mechanics themselves are defined in the MASSAR Sync feature

  # ---------------------------------------------------------------
  # Deadlines
  # ---------------------------------------------------------------

  @grading @deadlines
  Scenario: Reject new grade entry after the term's grading deadline has passed
    Given term 1 of "2026-2027" has a grade-entry deadline of 2027-01-10
    And the current date is 2027-01-12
    When "Nadia Fassi" attempts to enter a new grade for term 1
    Then the entry should be rejected
    And the system should indicate the grading window for term 1 is closed

  @grading @deadlines @director
  Scenario: A director can reopen grade entry after the deadline for an exceptional correction
    Given the term-1 grading window is closed
    When a director explicitly reopens grade entry for "Mathématiques" in "CP1-A"
    Then "Nadia Fassi" should be able to enter or correct grades for a limited window
    And the reopening action should be recorded in the audit log

  # ---------------------------------------------------------------
  # Reporting
  # ---------------------------------------------------------------

  @grading @parent
  Scenario: A parent views their child's grades in real time as they are entered
    Given "Nadia Fassi" has entered a grade for "Rania Idrissi" on "Contrôle 1"
    When the parent "fatima.idrissi@example.com" opens the grades section
    Then they should see the new grade immediately, without waiting for the report card

  @grading @director
  Scenario: A director views class-level average trends across terms
    Given "CP1-A" has completed report cards for terms 1 and 2
    When a director views the class performance dashboard
    Then they should see the class average per subject for each term side by side
