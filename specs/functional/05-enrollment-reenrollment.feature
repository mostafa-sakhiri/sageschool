\# maps to: students, enrollments, parents_students
\# depends on: Admissions, Academic Structure Setup, Users & Roles
\# depended on by: Attendance, Grading & Bulletins, MASSAR Sync, Tuition & Billing,
\#                 Communication, Transport, Cafeteria, Library, Discipline — nearly everything

Feature: Enrollment & Re-enrollment
  As a school secretary or director
  I want to turn accepted applications into enrolled students, and re-enroll them each year
  So that every other workflow in the system has an actual student to attach to

  Background:
    Given the school "École Al Amal - Campus Principal" exists
    And the academic year "2026-2027" exists for the school
    And the class "CP1-A" exists for academic year "2026-2027"

  # ---------------------------------------------------------------
  # Creating a student record
  # ---------------------------------------------------------------

  @enrollment @secretary
  Scenario: Convert an accepted application into a student record
    Given the application for "Rania Idrissi" has status "accepted"
    When a secretary converts the application into a student
    Then a new student record "Rania Idrissi" should be created at the school
    And the application's converted_student_id should point to the new student
    And the student's enrollment_status should be "active"

  @enrollment @secretary
  Scenario: Create a student record directly, without a prior application
    When I create a student directly with:
      | first_name  | Omar     |
      | last_name   | Tahiri   |
      | school      | École Al Amal - Campus Principal |
    Then the student "Omar Tahiri" should be created
    Note: used for migrations from a previous system, not the standard admissions path

  # ---------------------------------------------------------------
  # MASSAR code
  # ---------------------------------------------------------------

  @enrollment @massar
  Scenario: Assign a MASSAR code to a student
    Given the student "Rania Idrissi" exists with no MASSAR code
    When a secretary assigns MASSAR code "M2026778812" to the student
    Then "Rania Idrissi" should have massar_code "M2026778812"

  @enrollment @massar
  Scenario: Reject a duplicate MASSAR code within the same school
    Given the student "Omar Tahiri" already has massar_code "M2026778812" at the school
    When a secretary attempts to assign massar_code "M2026778812" to "Rania Idrissi" at the same school
    Then the assignment should fail with a validation error

  @enrollment @massar
  Scenario: A student may temporarily exist without a MASSAR code
    Given the student "Rania Idrissi" was just created and has no MASSAR code
    Then the student should still be fully usable for class assignment, attendance, and billing
    And a pending-MASSAR-code flag should be visible to the secretariat

  # ---------------------------------------------------------------
  # Linking parents
  # ---------------------------------------------------------------

  @enrollment @secretary
  Scenario: Link a parent user to a newly created student
    Given the student "Rania Idrissi" exists
    And the user "fatima.idrissi@example.com" exists
    When I link "fatima.idrissi@example.com" to "Rania Idrissi" with:
      | relationship                  | mother |
      | is_primary_contact            | true   |
      | is_financially_responsible    | true   |
    Then "fatima.idrissi@example.com" should appear as a parent of "Rania Idrissi"

  @enrollment
  Scenario: Link two parents to the same student
    Given the student "Rania Idrissi" exists
    And the users "fatima.idrissi@example.com" and "karim.idrissi@example.com" exist
    When I link both users to "Rania Idrissi" as mother and father respectively
    Then "Rania Idrissi" should have two linked parents
    And only one of them needs is_financially_responsible set to true

  @enrollment
  Scenario: One parent account is linked to multiple children
    Given the user "fatima.idrissi@example.com" exists
    And the students "Rania Idrissi" and "Yassine Idrissi" both exist at the school
    When I link "fatima.idrissi@example.com" to both students
    Then "fatima.idrissi@example.com" should see both children under one account

  # ---------------------------------------------------------------
  # First enrollment
  # ---------------------------------------------------------------

  @enrollment @secretary
  Scenario: Create the first enrollment record for a new student
    Given the student "Rania Idrissi" exists with no enrollment yet
    When I enroll "Rania Idrissi" into class "CP1-A" for academic year "2026-2027"
    Then an enrollment record should be created with status "active"
    And "Rania Idrissi".current_class_id should be updated to "CP1-A"

  @enrollment
  Scenario: Reject a second active enrollment for the same student in the same academic year
    Given "Rania Idrissi" is already actively enrolled in "CP1-A" for "2026-2027"
    When someone attempts to enroll "Rania Idrissi" into another class for the same academic year
    Then the attempt should fail with a validation error

  @enrollment @security
  Scenario: Prevent enrolling a student into a class belonging to a different school
    Given the student "Rania Idrissi" belongs to "École Al Amal - Campus Principal"
    And a class "6ème-B" belongs to a different school "Nour Rabat"
    When someone attempts to enroll "Rania Idrissi" into "6ème-B"
    Then the enrollment should be rejected
    And a cross-school data integrity error should be logged

  @enrollment
  Scenario: Enrollment respects class capacity
    Given the class "CP1-A" has capacity 30 and already has 30 active enrollments
    When someone attempts to enroll a 31st student into "CP1-A"
    Then the system should warn that the class is at capacity
    And require explicit confirmation or a capacity override to proceed

  # ---------------------------------------------------------------
  # Réinscription (re-enrollment for a new academic year)
  # ---------------------------------------------------------------

  @enrollment @reenrollment
  Scenario: Re-enroll a returning student into the next academic year
    Given "Rania Idrissi" was actively enrolled in "CP1-A" for academic year "2026-2027"
    And the academic year "2027-2028" exists for the school
    And the class "CP2-A" exists for "2027-2028"
    When a secretary re-enrolls "Rania Idrissi" into "CP2-A" for "2027-2028"
    Then a new enrollment record should be created for "2027-2028"
    And "Rania Idrissi".current_class_id should update to "CP2-A"
    And the "2026-2027" enrollment record should remain in history unchanged

  @enrollment @reenrollment
  Scenario: Send a re-enrollment reminder before the deadline
    Given the academic year "2026-2027" end_date is approaching
    And "Rania Idrissi" has no enrollment yet created for "2027-2028"
    When the re-enrollment reminder job runs
    Then a communication should be drafted to "Rania Idrissi"'s primary contact parent
    Note: actual message delivery is defined in the Communication feature

  # ---------------------------------------------------------------
  # Withdrawal, transfer, graduation
  # ---------------------------------------------------------------

  @enrollment
  Scenario: Withdraw a student mid-year
    Given "Rania Idrissi" is actively enrolled in "CP1-A" for "2026-2027"
    When a secretary withdraws "Rania Idrissi" effective 2027-01-15
    Then the enrollment status should become "withdrawn"
    And the student's enrollment_status should become "withdrawn"
    And "Rania Idrissi" should no longer appear in active attendance or billing for periods after 2027-01-15

  @enrollment
  Scenario: A withdrawn student can be re-enrolled later
    Given "Omar Tahiri" has enrollment_status "withdrawn"
    When a secretary creates a new enrollment for "Omar Tahiri" in a current class
    Then "Omar Tahiri" enrollment_status should return to "active"
    And a new enrollment record should be created, preserving the withdrawal history

  @enrollment
  Scenario: Transfer a student to a different class within the same academic year
    Given "Rania Idrissi" is enrolled in "CP1-A" for "2026-2027"
    And the class "CP1-B" exists for the same academic year at the same school
    When a secretary transfers "Rania Idrissi" to "CP1-B"
    Then "Rania Idrissi".current_class_id should update to "CP1-B"
    And the existing enrollment record's class_id should update accordingly, not create a duplicate

  @enrollment @lycee
  Scenario: Graduate a student at the end of their final year
    Given "Yassine Idrissi" is enrolled in the terminal lycée class for "2026-2027"
    When the academic year ends and the class is marked as a graduating class
    Then "Yassine Idrissi" enrollment_status should become "graduated"
    And no further re-enrollment reminder should be sent for this student
