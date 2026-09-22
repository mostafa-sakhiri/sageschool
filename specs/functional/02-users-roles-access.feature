\# maps to: users, roles, user_school_roles
\# depends on: Organization & School Setup
\# depended on by: everything a human actor does in the system

Feature: Users, Roles & Access Control
  As a school administrator
  I want to create user accounts and assign them roles per school
  So that each person sees and can act only on what their role allows

  Background:
    Given the organization "Groupe Nour Education" exists with type "group"
    And the school "Nour Rabat" exists under "Groupe Nour Education"
    And the school "Nour Marrakech" exists under "Groupe Nour Education"
    And the following roles exist: director, secretary, accountant, teacher, parent, student, hr

  # ---------------------------------------------------------------
  # User creation
  # ---------------------------------------------------------------

  @foundation
  Scenario: Create a user account under an organization
    When I create a user with:
      | first_name          | Salma    |
      | last_name           | Bennani  |
      | email               | salma.bennani@nour.ma |
      | preferred_language  | fr        |
    Then the user "salma.bennani@nour.ma" should be created under "Groupe Nour Education"
    And the user should have no school roles assigned yet

  @foundation
  Scenario: Reject a duplicate email within the platform
    Given a user with email "salma.bennani@nour.ma" already exists
    When I attempt to create another user with email "salma.bennani@nour.ma"
    Then the creation should fail with a validation error

  # ---------------------------------------------------------------
  # Role assignment — single school
  # ---------------------------------------------------------------

  @foundation @rbac
  Scenario: Assign a teacher role to a user at one school
    Given the user "salma.bennani@nour.ma" exists
    When I assign the role "teacher" to "salma.bennani@nour.ma" at school "Nour Rabat"
    Then "salma.bennani@nour.ma" should have role "teacher" at "Nour Rabat"
    And "salma.bennani@nour.ma" should NOT have any role at "Nour Marrakech"

  @foundation @rbac
  Scenario Outline: Assign each supported role at a school
    Given the user "<email>" exists
    When I assign the role "<role>" to "<email>" at school "Nour Rabat"
    Then "<email>" should have role "<role>" at "Nour Rabat"

    Examples:
      | email                     | role       |
      | director@nour.ma          | director   |
      | secretary@nour.ma         | secretary  |
      | accountant@nour.ma        | accountant |
      | teacher@nour.ma           | teacher    |
      | parent@nour.ma            | parent     |
      | student@nour.ma           | student    |
      | hr@nour.ma                | hr         |

  # ---------------------------------------------------------------
  # Multi-school access (the case this table exists to solve)
  # ---------------------------------------------------------------

  @foundation @rbac @multischool
  Scenario: One parent account accesses children in two different schools of the same group
    Given the user "parent.karimi@example.com" exists under "Groupe Nour Education"
    And a student "Yasmine Karimi" is enrolled at "Nour Rabat"
    And a student "Adam Karimi" is enrolled at "Nour Marrakech"
    When I assign the role "parent" to "parent.karimi@example.com" at "Nour Rabat"
    And I assign the role "parent" to "parent.karimi@example.com" at "Nour Marrakech"
    Then "parent.karimi@example.com" should log in once
    And see both "Yasmine Karimi" at "Nour Rabat" and "Adam Karimi" at "Nour Marrakech" in the same session

  @foundation @rbac @multischool
  Scenario: A group-level director holds the director role at every school of the group
    Given the user "founder@nour.ma" exists under "Groupe Nour Education"
    When I assign the role "director" to "founder@nour.ma" at "Nour Rabat"
    And I assign the role "director" to "founder@nour.ma" at "Nour Marrakech"
    Then "founder@nour.ma" should see a consolidated dashboard combining both schools
    And each school's underlying data should remain isolated in storage

  @foundation @rbac
  Scenario: A user can hold different roles at different schools
    Given the user "hicham@example.com" exists
    When I assign the role "teacher" to "hicham@example.com" at "Nour Rabat"
    And I assign the role "parent" to "hicham@example.com" at "Nour Marrakech"
    Then "hicham@example.com" should have role "teacher" at "Nour Rabat"
    And "hicham@example.com" should have role "parent" at "Nour Marrakech"

  # ---------------------------------------------------------------
  # Access denial
  # ---------------------------------------------------------------

  @foundation @rbac @security
  Scenario: Deny access to a school where the user has no assigned role
    Given the user "teacher@nour.ma" has role "teacher" only at "Nour Rabat"
    When "teacher@nour.ma" attempts to view student data at "Nour Marrakech"
    Then access should be denied
    And the attempt should be recorded in the audit log

  @foundation @rbac @security
  Scenario: Revoke a user's access to a school
    Given "secretary@nour.ma" has role "secretary" at "Nour Rabat"
    When an administrator revokes "secretary@nour.ma" access to "Nour Rabat"
    Then "secretary@nour.ma" should no longer have any role at "Nour Rabat"
    And "secretary@nour.ma" should be immediately signed out of any active session for "Nour Rabat"

  # ---------------------------------------------------------------
  # Account lifecycle
  # ---------------------------------------------------------------

  @foundation @lifecycle
  Scenario: Deactivate a user account without deleting their history
    Given the user "old.teacher@nour.ma" has role "teacher" at "Nour Rabat"
    When an administrator deactivates "old.teacher@nour.ma"
    Then "old.teacher@nour.ma" should be unable to log in
    And grades and records previously entered by "old.teacher@nour.ma" should remain unchanged

  @foundation
  Scenario: Record last login timestamp
    Given the user "salma.bennani@nour.ma" exists
    When "salma.bennani@nour.ma" successfully logs in
    Then the user's last_login_at should be updated to the current time
