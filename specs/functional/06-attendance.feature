\# maps to: attendance_records
\# depends on: Enrollment & Re-enrollment (active students in classes), Academic Structure Setup
\#             (classes), Users & Roles (teacher/staff recording), Timetabling (optional link)
\# depended on by: Communication (absence notifications), Discipline, MASSAR Sync

Feature: Attendance
  As a teacher or school administrator
  I want to record and track student attendance
  So that absences are caught early, parents are informed, and MASSAR stays compliant

  Background:
    Given the school "École Al Amal - Campus Principal" exists
    And the academic year "2026-2027" is current for the school
    And the class "CP1-A" exists for "2026-2027"
    And "Rania Idrissi" is actively enrolled in "CP1-A"
    And a staff member "Nadia Fassi" with staff_type "teacher" is the homeroom teacher of "CP1-A"

  # ---------------------------------------------------------------
  # Recording attendance
  # ---------------------------------------------------------------

  @attendance @teacher
  Scenario: Record a student as present
    When "Nadia Fassi" records attendance for "Rania Idrissi" on 2026-10-05 with status "present"
    Then an attendance record should exist for "Rania Idrissi" on 2026-10-05 with status "present"
    And recorded_by should be "Nadia Fassi"

  @attendance @teacher
  Scenario Outline: Record each supported attendance status
    When "Nadia Fassi" records attendance for "Rania Idrissi" on 2026-10-06 with status "<status>"
    Then the attendance record should have status "<status>"

    Examples:
      | status  |
      | present |
      | absent  |
      | late    |
      | excused |

  @attendance
  Scenario: Reject an invalid attendance status
    When "Nadia Fassi" attempts to record attendance with status "sick"
    Then the recording should fail with a validation error

  @attendance @teacher
  Scenario: Bulk roll-call for an entire class in one action
    Given "CP1-A" has 28 actively enrolled students
    When "Nadia Fassi" performs roll call for "CP1-A" on 2026-10-05, marking all present except "Omar Tahiri" as absent
    Then 27 attendance records should be created with status "present"
    And 1 attendance record should be created for "Omar Tahiri" with status "absent"

  @attendance
  Scenario: Prevent a duplicate attendance record for the same student, date, and class
    Given an attendance record already exists for "Rania Idrissi" in "CP1-A" on 2026-10-05
    When "Nadia Fassi" attempts to record attendance again for "Rania Idrissi" in "CP1-A" on 2026-10-05
    Then the system should update the existing record instead of creating a duplicate

  @attendance @security
  Scenario: Prevent recording attendance for a student not enrolled in that class
    Given "Omar Tahiri" is enrolled in a different class "CP1-B"
    When "Nadia Fassi" attempts to record attendance for "Omar Tahiri" in "CP1-A"
    Then the recording should fail with a validation error

  @attendance
  Scenario: Attendance cannot be recorded for a withdrawn student
    Given "Rania Idrissi" has enrollment_status "withdrawn" as of 2027-01-15
    When "Nadia Fassi" attempts to record attendance for "Rania Idrissi" on 2027-02-01
    Then the recording should fail
    And the system should indicate the student is no longer actively enrolled

  # ---------------------------------------------------------------
  # Justification
  # ---------------------------------------------------------------

  @attendance @parent
  Scenario: A parent justifies their child's absence
    Given an attendance record exists for "Rania Idrissi" on 2026-10-05 with status "absent"
    When the parent "fatima.idrissi@example.com" submits a justification "Rendez-vous médical"
    Then the attendance record's status should update to "excused"
    And the justification text should be stored on the record

  @attendance
  Scenario: A late justification does not retroactively remove the absence from historical reports
    Given an attendance record for "Rania Idrissi" on 2026-10-05 was "absent" and later justified as "excused" on 2026-10-08
    When a director views the October attendance report generated on 2026-10-06
    Then that report should still reflect the absence as it stood on 2026-10-06
    Note: historical/point-in-time reporting integrity is required for audit purposes

  # ---------------------------------------------------------------
  # Notifications & alerts (hand-off to Communication)
  # ---------------------------------------------------------------

  @attendance @notifications
  Scenario: An absence triggers a parent notification draft
    When "Nadia Fassi" records "Rania Idrissi" as absent on 2026-10-05
    Then a communication should be drafted to "Rania Idrissi"'s primary contact parent
    Note: actual message content and delivery are defined in the Communication feature

  @attendance @alerts @director
  Scenario: Repeated absences raise a flag for the director
    Given "Omar Tahiri" has accumulated 5 unexcused absences in "2026-2027"
    When the absence threshold job runs
    Then "Omar Tahiri" should be flagged as at-risk on the director's dashboard

  # ---------------------------------------------------------------
  # MASSAR
  # ---------------------------------------------------------------

  @attendance @massar
  Scenario: Attendance records become eligible for MASSAR export
    Given "École Al Amal - Campus Principal" has requires_massar_sync set to true
    And attendance records exist for "CP1-A" for the month of October 2026
    When the MASSAR export job runs for entity_type "attendance"
    Then a massar_sync_log entry should be created with status "pending"
    Note: the actual export mechanics are defined in the MASSAR Sync feature

  @attendance @massar
  Scenario: A préscolaire-only school does not generate MASSAR attendance exports
    Given a school "Jardin d'Enfants Al Amal" has requires_massar_sync set to false
    And attendance records exist for one of its classes
    When the MASSAR export job runs
    Then no massar_sync_log entry should be created for that school's attendance

  # ---------------------------------------------------------------
  # Reporting
  # ---------------------------------------------------------------

  @attendance @director
  Scenario: View a student's full attendance history
    Given "Rania Idrissi" has attendance records spanning September through December 2026
    When a director opens "Rania Idrissi"'s attendance history
    Then they should see every record in chronological order with status and any justification

  @attendance @director
  Scenario: View a class-level attendance summary for a given date
    Given "CP1-A" has attendance recorded for 2026-10-05
    When a director requests the attendance summary for "CP1-A" on 2026-10-05
    Then they should see counts of present, absent, late, and excused students
