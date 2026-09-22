\# maps to: massar_sync_log, schools.requires_massar_sync, schools.massar_etablissement_code,
\#          students.massar_code, report_cards.massar_sync_status
\# depends on: Enrollment & Re-enrollment (students), Attendance, Grading & Bulletins (report_cards)
\# depended on by: nothing further downstream — this is the terminal regulatory step
\#
\# IMPORTANT CONTEXT: MASSAR has no public, documented API. In practice this feature
\# produces MASSAR-format export files (validated against the Ministry's expected
\# column structure) for a human to review and submit, with an optional browser-
\# automation fallback. It is NOT a fully autonomous "push" integration. Every export
\# scenario below assumes a human confirmation step before anything is considered final.

Feature: MASSAR Synchronization
  As a secretary or director at a school subject to MASSAR reporting
  I want to generate MASSAR-compliant exports and track their submission status
  So that the school stays compliant without re-typing every record by hand

  Background:
    Given the school "École Al Amal - Campus Principal" exists
    And requires_massar_sync is true for that school
    And massar_etablissement_code is set for the school

  # ---------------------------------------------------------------
  # Eligibility
  # ---------------------------------------------------------------

  @massar
  Scenario: A school with requires_massar_sync false never generates MASSAR exports
    Given the school "Jardin d'Enfants Al Amal" has requires_massar_sync set to false
    When the nightly MASSAR export job runs across all schools
    Then no massar_sync_log entries should be created for "Jardin d'Enfants Al Amal"

  # ---------------------------------------------------------------
  # Export generation — students / enrollment
  # ---------------------------------------------------------------

  @massar @secretary
  Scenario: Generate a MASSAR-format student export file
    Given 3 students were newly enrolled at the school this month
    When a secretary generates the MASSAR student export
    Then a file matching MASSAR's expected column structure should be produced
    And a massar_sync_log entry should be created with entity_type "student", sync_type "export_file", status "pending"

  @massar
  Scenario: Reject generating a student export if a required field is missing
    Given a newly enrolled student "Yassine Karimi" has no date_of_birth recorded
    When a secretary attempts to generate the MASSAR student export
    Then "Yassine Karimi" should be excluded from the file with a listed reason
    And the rest of the batch should still be generated normally

  @massar
  Scenario: The export file preserves MASSAR's exact column names and order
    When any MASSAR export file is generated
    Then its column headers and order should exactly match the Ministry's current reference template
    Note: per known MASSAR import behavior, altering column names, order, or student-name
    formatting causes the Ministry's own re-import step to fail

  # ---------------------------------------------------------------
  # Export generation — grades & report cards
  # ---------------------------------------------------------------

  @massar
  Scenario: Only teacher-approved report cards are eligible for MASSAR export
    Given "Rania Idrissi"'s term-1 report card has only an ai_generated_comment, no teacher_comment
    When the MASSAR grade export batch is generated
    Then that report card should be excluded from the batch
    And the secretary should see it listed under "awaiting teacher approval"

  @massar @secretary
  Scenario: Generate the MASSAR grade export for a class once all report cards are approved
    Given every student in "CP1-A" has a teacher-approved term-1 report card
    When a secretary generates the MASSAR grade export for "CP1-A" term 1
    Then a massar_sync_log entry should be created with entity_type "report_card", sync_type "export_file"
    And each included report card's massar_sync_status should move from "pending" to "exported"

  @massar
  Scenario: A single ungraded subject blocks that student from the class-level export batch
    Given "Omar Tahiri" is missing a grade in one subject for term 1
    When a secretary generates the MASSAR grade export for "CP1-A" term 1
    Then "Omar Tahiri" should be excluded from the export with the missing subject listed
    And the rest of the class should still be included
    Note: mirrors the same blocking rule enforced earlier in Grading & Bulletins

  # ---------------------------------------------------------------
  # Export generation — attendance
  # ---------------------------------------------------------------

  @massar
  Scenario: Generate a monthly MASSAR attendance export
    Given "CP1-A" has attendance records for the full month of October 2026
    When a secretary generates the MASSAR attendance export for October 2026
    Then a massar_sync_log entry should be created with entity_type "attendance", sync_type "export_file"

  # ---------------------------------------------------------------
  # Human confirmation step (no autonomous push exists)
  # ---------------------------------------------------------------

  @massar @secretary
  Scenario: A generated export requires explicit human submission before being marked exported
    Given a MASSAR student export file has been generated with status "pending"
    When the secretary downloads the file, submits it through the MASSAR portal, and confirms submission in the app
    Then the massar_sync_log entry's status should update to "success"
    And synced_at should be recorded

  @massar
  Scenario: A generated file that is never confirmed remains visibly pending
    Given a MASSAR export file was generated 5 days ago and never confirmed as submitted
    When a director views the MASSAR sync dashboard
    Then that export should still show status "pending"
    And it should be flagged as overdue for follow-up

  # ---------------------------------------------------------------
  # Browser-automation fallback (optional, higher-risk path)
  # ---------------------------------------------------------------

  @massar @security
  Scenario: Browser-automation sync requires securely stored MASSAR credentials
    Given a school opts into the browser-automation sync method instead of manual file submission
    When the school's MASSAR login is configured
    Then the credentials should be stored encrypted at rest
    And they should never appear in plaintext in audit_log or massar_sync_log entries

  @massar @security
  Scenario: A failed browser-automation attempt does not expose credentials in the error message
    Given a browser-automation sync attempt fails due to a MASSAR page structure change
    When the error is recorded
    Then error_message should describe the failure without including the stored credentials

  # ---------------------------------------------------------------
  # Error handling & retry
  # ---------------------------------------------------------------

  @massar
  Scenario: Record a sync failure with a clear error message
    Given a MASSAR export was submitted and the Ministry's system rejected it
    When the rejection is recorded
    Then the massar_sync_log entry's status should become "error"
    And error_message should describe the rejection reason
    And massar_sync_status on any linked report_cards should revert to "error"

  @massar @secretary
  Scenario: Retry a failed sync after correcting the underlying data
    Given a MASSAR export failed because a student was missing a required field
    And the missing field has since been corrected
    When the secretary regenerates and resubmits the export
    Then a new massar_sync_log entry should be created for the retry
    And the original failed entry should remain in history for audit purposes

  @massar
  Scenario: Detect and flag a likely MASSAR format change
    Given multiple export submissions have failed with structurally similar errors within a short period
    When the pattern is detected
    Then the platform should flag a possible MASSAR format change
    And notify the platform operator, not just the affected school
    Note: MASSAR's UI/format can change without notice since no official API contract exists

  # ---------------------------------------------------------------
  # Confirmation (Ministry-side acknowledgment)
  # ---------------------------------------------------------------

  @massar
  Scenario: Mark a report card as confirmed once the Ministry-side bulletin is verified
    Given "Rania Idrissi"'s report card has massar_sync_status "exported"
    When a secretary verifies on the MASSAR portal that the bulletin was accepted
    And marks it as confirmed in the app
    Then massar_sync_status should update to "confirmed"

  # ---------------------------------------------------------------
  # Deadlines & alerts
  # ---------------------------------------------------------------

  @massar @alerts @director
  Scenario: Alert the school ahead of a national MASSAR grade-entry deadline
    Given a national grade-entry deadline is set for 2027-01-10
    And it is now 2027-01-05
    And "CP1-A" still has students with incomplete grades
    Then the director should receive an alert listing students blocking readiness before the deadline

  # ---------------------------------------------------------------
  # Visibility & audit
  # ---------------------------------------------------------------

  @massar @director
  Scenario: View overall MASSAR sync health for the school
    Given the school has a mix of successful, pending, and failed sync entries over the term
    When a director opens the MASSAR sync dashboard
    Then they should see counts by status and the most recent failures with their error messages

  @massar
  Scenario: Every sync attempt is preserved for audit, including failures
    Given a school has had 12 MASSAR sync attempts this term, including 2 failures
    When someone queries the massar_sync_log for that school
    Then all 12 entries should be present, including the 2 failed ones with their error details
