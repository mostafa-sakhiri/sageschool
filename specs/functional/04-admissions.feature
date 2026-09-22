\# maps to: admission_applications, documents
\# depends on: Organization & School Setup, Academic Structure Setup, Users & Roles
\# depended on by: Enrollment & Re-enrollment (conversion of an accepted application into a student)

Feature: Admissions
  As a school secretary or director
  I want to track prospective students from first inquiry through acceptance
  So that no dossier is lost before it becomes an actual enrollment

  Background:
    Given the school "École Al Amal - Campus Principal" exists
    And the academic year "2026-2027" exists for the school
    And the grade level "CP1" exists for the school

  # ---------------------------------------------------------------
  # Creating an inquiry
  # ---------------------------------------------------------------

  @admissions @secretary
  Scenario: Submit a new admission inquiry
    When I create an admission application with:
      | first_name                | Rania         |
      | last_name                 | Idrissi       |
      | date_of_birth              | 2020-03-14    |
      | desired_grade_level        | CP1            |
      | desired_academic_year      | 2026-2027      |
      | parent_name                | Fatima Idrissi |
      | parent_phone                | 0661234567     |
      | source                       | website        |
    Then the application should be created with status "inquiry"

  @admissions
  Scenario: Reject an application missing the child's name
    When I attempt to create an admission application with no first_name or last_name
    Then the creation should fail with a validation error

  @admissions
  Scenario: An application does not require a MASSAR code
    When I create an admission application for "Rania Idrissi"
    Then the application should be created successfully
    And it should have no MASSAR code, since prospects are not yet registered students

  # ---------------------------------------------------------------
  # Document upload & OCR
  # ---------------------------------------------------------------

  @admissions @documents
  Scenario: Upload a supporting document to an application
    Given the application for "Rania Idrissi" exists
    When I upload a document to the application with:
      | category  | birth_certificate |
      | file_url  | /uploads/rania-acte-naissance.pdf |
    Then the document should be linked to the application with owner_type "application"
    And its ocr_status should be "pending"

  @admissions @documents
  Scenario: OCR extraction completes and populates structured data
    Given a document with category "cin" is uploaded and ocr_status is "pending"
    When the OCR pipeline processes the document
    Then ocr_status should become "done"
    And ocr_extracted_data should contain the recognized fields

  @admissions @documents
  Scenario: OCR extraction fails gracefully
    Given a document with category "vaccination_record" is uploaded and ocr_status is "pending"
    When the OCR pipeline fails to process the document
    Then ocr_status should become "failed"
    And the secretary should be prompted to enter the data manually
    And the application should not be blocked from progressing

  @admissions @documents
  Scenario: A photo document does not require OCR
    Given a document with category "photo" is uploaded
    Then its ocr_status should be "not_applicable"

  # ---------------------------------------------------------------
  # Status transitions
  # ---------------------------------------------------------------

  @admissions @secretary
  Scenario Outline: Valid application status transitions
    Given the application for "Rania Idrissi" has status "<from_status>"
    When the status is changed to "<to_status>"
    Then the application status should be "<to_status>"

    Examples:
      | from_status | to_status  |
      | inquiry     | waitlisted |
      | inquiry     | accepted   |
      | inquiry     | rejected   |
      | waitlisted  | accepted   |
      | waitlisted  | rejected   |

  @admissions
  Scenario: Reject an invalid status value
    Given the application for "Rania Idrissi" has status "inquiry"
    When I attempt to set the status to "enrolled" directly without an accepted student conversion
    Then the system should require conversion through the enrollment workflow instead
    And the raw status field should still only accept "inquiry", "waitlisted", "accepted", "rejected", or "enrolled"

  @admissions
  Scenario: A rejected application can be reconsidered
    Given the application for "Rania Idrissi" has status "rejected"
    When a director reopens the application
    Then its status should return to "inquiry"
    And the previous rejection should remain visible in the application's history

  # ---------------------------------------------------------------
  # Waitlist & capacity awareness
  # ---------------------------------------------------------------

  @admissions
  Scenario: Waitlist an application when the desired class is full
    Given the class "CP1-A" has capacity 30 and 30 active enrollments
    And the application for "Rania Idrissi" targets grade level "CP1" for "2026-2027"
    When a secretary attempts to accept the application directly into "CP1-A"
    Then the system should suggest waitlisting instead
    And the secretary may still override and accept if another class or section has room

  # ---------------------------------------------------------------
  # Conversion (hand-off to Enrollment)
  # ---------------------------------------------------------------

  @admissions @enrollment-handoff
  Scenario: An accepted application becomes eligible for conversion into a student
    Given the application for "Rania Idrissi" has status "accepted"
    Then the application should be flagged as ready for conversion
    And the Enrollment workflow should be able to create a student record from it

  @admissions
  Scenario: A converted application is locked from further edits
    Given the application for "Rania Idrissi" has been converted to student "Rania Idrissi" (student record)
    When someone attempts to edit the original application's name or date_of_birth
    Then the edit should be rejected
    And the application should show a reference to converted_student_id

  # ---------------------------------------------------------------
  # Reporting
  # ---------------------------------------------------------------

  @admissions @director
  Scenario: View the admissions funnel by status
    Given "École Al Amal - Campus Principal" has applications in every status
    When a director views the admissions dashboard
    Then they should see counts grouped by status: inquiry, waitlisted, accepted, rejected, enrolled
