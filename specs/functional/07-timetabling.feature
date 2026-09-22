\# maps to: teacher_subjects, timetable_slots
\# depends on: Academic Structure Setup (classes, subjects), Users & Roles / staff (teachers)
\# depended on by: Attendance (optional timetable_slot_id link), Grading & Bulletins (per-class/
\#                 subject assessments), HR (class_substitutions)

Feature: Timetabling
  As a school administrator
  I want to assign teachers to subjects and build a weekly timetable per class
  So that attendance, grading, and substitutions all have a schedule to reference

  Background:
    Given the school "École Al Amal - Campus Principal" exists
    And the academic year "2026-2027" is current for the school
    And the class "CP1-A" exists for "2026-2027"
    And the subject "Mathématiques" exists for the school
    And a staff member "Nadia Fassi" with staff_type "teacher" exists at the school

  # ---------------------------------------------------------------
  # Teacher-subject assignment
  # ---------------------------------------------------------------

  @timetable @director
  Scenario: Assign a teacher to teach a subject in a class
    When I assign "Nadia Fassi" to teach "Mathématiques" in "CP1-A"
    Then "Nadia Fassi" should be listed as a teacher of "Mathématiques" for "CP1-A"

  @timetable
  Scenario: A teacher can be assigned to multiple subjects across multiple classes
    Given "Nadia Fassi" teaches "Mathématiques" in "CP1-A"
    When I also assign "Nadia Fassi" to teach "Sciences" in "CP1-A"
    And I assign "Nadia Fassi" to teach "Mathématiques" in a different class "CP1-B"
    Then "Nadia Fassi" should appear as teacher for all three assignments

  @timetable @security
  Scenario: Prevent assigning a teacher from a different school
    Given a staff member "Youssef Amrani" exists only at a different school "Nour Rabat"
    When someone attempts to assign "Youssef Amrani" to teach "Mathématiques" in "CP1-A"
    Then the assignment should fail with a validation error

  @timetable
  Scenario: Reject a duplicate teacher-subject-class assignment
    Given "Nadia Fassi" already teaches "Mathématiques" in "CP1-A"
    When someone attempts to assign "Nadia Fassi" to "Mathématiques" in "CP1-A" again
    Then the system should treat it as already assigned and make no duplicate entry

  # ---------------------------------------------------------------
  # Building the timetable
  # ---------------------------------------------------------------

  @timetable @director
  Scenario: Create a single timetable slot
    Given "Nadia Fassi" teaches "Mathématiques" in "CP1-A"
    When I create a timetable slot with:
      | class        | CP1-A          |
      | subject      | Mathématiques   |
      | teacher      | Nadia Fassi      |
      | day_of_week  | 1 (Monday)       |
      | start_time   | 08:30             |
      | end_time     | 09:30             |
      | room         | Salle 12           |
    Then the slot should exist on the timetable for "CP1-A"

  @timetable @ai
  Scenario: Auto-generate a full weekly timetable for a class
    Given "CP1-A" has 6 subjects each requiring a defined number of weekly hours
    And teachers are assigned to each subject for "CP1-A"
    When the timetable generator runs for "CP1-A"
    Then a conflict-free set of timetable slots should be created covering the required weekly hours
    And no teacher or room should be double-booked within the generated result

  @timetable
  Scenario: Reject double-booking a teacher across two classes at the same time
    Given "Nadia Fassi" is scheduled to teach "CP1-A" on Monday from 08:30 to 09:30
    When someone attempts to schedule "Nadia Fassi" to teach a different class "CP1-B" on Monday from 08:30 to 09:30
    Then the creation should fail with a validation error indicating a teacher conflict

  @timetable
  Scenario: Reject double-booking a room at the same time
    Given "CP1-A" is scheduled in "Salle 12" on Monday from 08:30 to 09:30
    When someone attempts to schedule a different class in "Salle 12" on Monday from 08:30 to 09:30
    Then the creation should fail with a validation error indicating a room conflict

  @timetable
  Scenario: Reject overlapping time slots for the same class
    Given "CP1-A" has "Mathématiques" scheduled Monday 08:30 to 09:30
    When someone attempts to schedule "Sciences" for "CP1-A" on Monday from 09:00 to 10:00
    Then the creation should fail with a validation error indicating a class schedule conflict

  @timetable
  Scenario: Reject a timetable slot with an invalid day_of_week
    When someone attempts to create a timetable slot with day_of_week 8
    Then the creation should fail with a validation error

  @timetable @director
  Scenario: Edit an existing timetable slot's room
    Given a timetable slot exists for "CP1-A" "Mathématiques" on Monday 08:30-09:30 in "Salle 12"
    When a director moves the slot to "Salle 14"
    Then the slot's room should update to "Salle 14"
    And no conflict should be raised if "Salle 14" is free at that time

  # ---------------------------------------------------------------
  # Viewing the timetable
  # ---------------------------------------------------------------

  @timetable @teacher
  Scenario: A teacher views their personal weekly timetable across all classes
    Given "Nadia Fassi" teaches in "CP1-A" and "CP1-B" with slots on different days
    When "Nadia Fassi" views her personal timetable
    Then she should see all her slots across both classes in one weekly view

  @timetable @parent
  Scenario: A parent views their child's class timetable
    Given "Rania Idrissi" is enrolled in "CP1-A"
    When the parent "fatima.idrissi@example.com" views the timetable
    Then they should see the full weekly schedule for "CP1-A"

  # ---------------------------------------------------------------
  # Deletion constraints
  # ---------------------------------------------------------------

  @timetable
  Scenario: Prevent deleting a timetable slot that already has attendance history
    Given attendance records exist that reference a specific timetable slot
    When someone attempts to delete that timetable slot
    Then the deletion should fail
    And the system should suggest deactivating future occurrences instead

  @timetable
  Scenario: Freely delete a timetable slot with no attendance history yet
    Given a timetable slot was created for next week and has no attendance records
    When a director deletes the slot
    Then the slot should be removed without error
