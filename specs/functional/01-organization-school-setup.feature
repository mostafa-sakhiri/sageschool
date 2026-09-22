\# maps to: organizations, schools, subscriptions
\# depended on by: everything else in the system

Feature: Organization & School Setup
  As a platform operator or school founder
  I want to create and configure an organization and its schools
  So that all other data (students, staff, billing) has a tenant to belong to

  Background:
    Given the platform has no existing organization named "École Al Amal"

  # ---------------------------------------------------------------
  # Organization creation
  # ---------------------------------------------------------------

  @foundation @onboarding
  Scenario: Create an independent organization for a single school
    When I create an organization with:
      | name           | École Al Amal      |
      | type           | independent         |
      | billing_email  | contact@alamal.ma   |
    Then the organization "École Al Amal" should be created with type "independent"
    And no schools should exist under it yet

  @foundation @onboarding
  Scenario: Create a group organization for a multi-school operator
    When I create an organization with:
      | name  | Groupe Nour Education |
      | type  | group                  |
    Then the organization "Groupe Nour Education" should be created with type "group"

  @foundation
  Scenario: Reject an organization without a name
    When I attempt to create an organization with an empty name
    Then the creation should fail with a validation error
    And no organization should be persisted

  # ---------------------------------------------------------------
  # School creation
  # ---------------------------------------------------------------

  @foundation @onboarding
  Scenario: Add the first school to an independent organization
    Given the organization "École Al Amal" exists with type "independent"
    When I create a school under "École Al Amal" with:
      | name                 | École Al Amal - Campus Principal |
      | city                 | Casablanca                        |
      | levels_offered       | primaire, college, lycee          |
      | requires_massar_sync | true                               |
    Then the school "École Al Amal - Campus Principal" should be created
    And it should belong to organization "École Al Amal"

  @foundation @multischool
  Scenario: Add a second school to a group organization
    Given the organization "Groupe Nour Education" exists with type "group"
    And a school "Nour Rabat" already exists under "Groupe Nour Education"
    When I create a school under "Groupe Nour Education" with:
      | name  | Nour Marrakech |
      | city  | Marrakech       |
    Then the school "Nour Marrakech" should be created
    And "Groupe Nour Education" should now have 2 schools

  @foundation
  Scenario: A préscolaire-only school does not require MASSAR sync
    Given the organization "École Al Amal" exists with type "independent"
    When I create a school under "École Al Amal" with:
      | name                 | Jardin d'Enfants Al Amal |
      | levels_offered       | prescolaire               |
      | requires_massar_sync | false                     |
    Then the school "Jardin d'Enfants Al Amal" should have requires_massar_sync set to false
    And features that depend on MASSAR sync should be hidden for this school

  @foundation
  Scenario: Reject a school with no levels_offered specified
    Given the organization "École Al Amal" exists with type "independent"
    When I attempt to create a school with an empty levels_offered list
    Then the creation should fail with a validation error

  @foundation
  Scenario Outline: Reject invalid organization type
    When I attempt to create an organization with type "<invalid_type>"
    Then the creation should fail with a validation error

    Examples:
      | invalid_type |
      | enterprise   |
      | school       |
      |              |

  # ---------------------------------------------------------------
  # Deactivation
  # ---------------------------------------------------------------

  @foundation @lifecycle
  Scenario: Deactivate a school without deleting its historical data
    Given the school "Nour Marrakech" exists and is active
    When a platform operator deactivates "Nour Marrakech"
    Then "Nour Marrakech" should have is_active set to false
    And its students, staff, and historical records should remain queryable
    And no new users should be able to log into "Nour Marrakech"

  # ---------------------------------------------------------------
  # Subscription / billing plan (your own SaaS billing to the school)
  # ---------------------------------------------------------------

  @foundation @billing
  Scenario: Assign a subscription plan to a new school
    Given the school "École Al Amal - Campus Principal" exists
    When I assign a subscription to it with:
      | plan_name      | standard  |
      | price_mad      | 28000     |
      | billing_cycle  | annual    |
      | max_students   | 500       |
    Then "École Al Amal - Campus Principal" should have an active subscription "standard"

  @foundation @billing
  Scenario: Warn when a school approaches its subscription's student cap
    Given the school "École Al Amal - Campus Principal" has an active subscription with max_students 500
    And it currently has 480 enrolled students
    When a new student enrollment is attempted
    Then the system should surface an upsell warning to the school administrator
    And the enrollment should still be allowed to proceed

  @foundation @billing
  Scenario: Mark a subscription as past due
    Given the school "École Al Amal - Campus Principal" has an active subscription
    When the subscription's payment is not received by its end_date
    Then the subscription status should change to "past_due"
    And the school administrator should be notified
