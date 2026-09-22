\# maps to: academic_years, grade_levels, classes, subjects
\# depends on: Organization & School Setup, Users & Roles (homeroom_teacher_id -> staff)
\# depended on by: Admissions, Enrollment, Attendance, Grading, Timetable, Communication

Feature: Academic Structure Setup
  As a school administrator
  I want to define academic years, grade levels, classes, and subjects
  So that enrollment, timetabling, attendance, and grading all have a structure to attach to

  Background:
    Given the school "École Al Amal - Campus Principal" exists

  # ---------------------------------------------------------------
  # Academic years
  # ---------------------------------------------------------------

  @foundation
  Scenario: Create a new academic year
    When I create an academic year for "École Al Amal - Campus Principal" with:
      | label       | 2026-2027   |
      | start_date  | 2026-09-07  |
      | end_date    | 2027-06-30  |
    Then the academic year "2026-2027" should exist for the school

  @foundation
  Scenario: Mark an academic year as the current one
    Given the academic year "2026-2027" exists for "École Al Amal - Campus Principal"
    And no academic year is currently marked as current for that school
    When I mark "2026-2027" as the current academic year
    Then "2026-2027" should have is_current set to true

  @foundation
  Scenario: Marking a new academic year as current un-marks the previous one
    Given "2025-2026" is the current academic year for "École Al Amal - Campus Principal"
    And "2026-2027" exists for the same school but is not current
    When I mark "2026-2027" as the current academic year
    Then "2026-2027" should have is_current set to true
    And "2025-2026" should have is_current set to false
    And exactly one academic year should be current for that school at any time

  @foundation
  Scenario: Reject overlapping academic year dates for the same school
    Given the academic year "2026-2027" exists for "École Al Amal - Campus Principal" with dates 2026-09-07 to 2027-06-30
    When I attempt to create another academic year for the same school with dates 2027-01-01 to 2027-12-31
    Then the creation should fail with a validation error

  # ---------------------------------------------------------------
  # Grade levels (cycles)
  # ---------------------------------------------------------------

  @foundation
  Scenario Outline: Define grade levels across the four Moroccan school cycles
    When I create a grade level for "École Al Amal - Campus Principal" with:
      | cycle | <cycle> |
      | name  | <name>  |
    Then the grade level "<name>" should exist under cycle "<cycle>"

    Examples:
      | cycle        | name                        |
      | prescolaire  | Petite Section               |
      | primaire     | CP1                           |
      | college      | 1ère Année Collège             |
      | lycee        | Tronc Commun Sciences           |

  @foundation
  Scenario: Reject a grade level with an invalid cycle value
    When I attempt to create a grade level with cycle "universite"
    Then the creation should fail with a validation error

  # ---------------------------------------------------------------
  # Classes
  # ---------------------------------------------------------------

  @foundation
  Scenario: Create a class within a grade level and academic year
    Given the academic year "2026-2027" exists for "École Al Amal - Campus Principal"
    And the grade level "CP1" exists for the school
    When I create a class with:
      | name            | CP1-A       |
      | academic_year   | 2026-2027   |
      | grade_level     | CP1          |
      | capacity        | 30           |
    Then the class "CP1-A" should exist for academic year "2026-2027"

  @foundation
  Scenario: Reject a duplicate class name within the same academic year
    Given the class "CP1-A" already exists for academic year "2026-2027"
    When I attempt to create another class named "CP1-A" for the same academic year
    Then the creation should fail with a validation error

  @foundation
  Scenario: Assign a homeroom teacher to a class
    Given the class "CP1-A" exists for academic year "2026-2027"
    And a staff member "Nadia Fassi" with staff_type "teacher" exists at the school
    When I assign "Nadia Fassi" as homeroom teacher of "CP1-A"
    Then "CP1-A" should have "Nadia Fassi" as its homeroom teacher

  @foundation
  Scenario: A class in one school cannot be assigned a homeroom teacher from another school
    Given the class "CP1-A" exists at "École Al Amal - Campus Principal"
    And a staff member "Youssef Amrani" exists only at a different school "Nour Rabat"
    When I attempt to assign "Youssef Amrani" as homeroom teacher of "CP1-A"
    Then the assignment should fail with a validation error

  @foundation
  Scenario: Allow a class to exist without a capacity limit
    Given the academic year "2026-2027" exists for "École Al Amal - Campus Principal"
    And the grade level "CP1" exists for the school
    When I create a class with no capacity value specified
    Then the class should be created successfully with capacity left unset

  # ---------------------------------------------------------------
  # Subjects
  # ---------------------------------------------------------------

  @foundation
  Scenario: Create a subject with a default coefficient
    When I create a subject for "École Al Amal - Campus Principal" with:
      | name                 | Mathématiques |
      | default_coefficient  | 4              |
    Then the subject "Mathématiques" should exist with default_coefficient 4

  @foundation
  Scenario: Create a subject without specifying a coefficient defaults to 1
    When I create a subject with:
      | name  | Éducation Artistique |
    Then the subject "Éducation Artistique" should have default_coefficient 1

  @foundation
  Scenario: Subjects are scoped per school, not shared across the organization
    Given the school "Nour Rabat" has a subject "Physique-Chimie" with default_coefficient 3
    When the school "Nour Marrakech" creates its own subject "Physique-Chimie" with default_coefficient 4
    Then both subjects should exist independently
    And a change to one school's "Physique-Chimie" should not affect the other's
