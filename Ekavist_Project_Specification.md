# Ekavist Project Management System

## Complete Product Requirements & Software Specification

**Document Version:** 1.0  
**Product:** Ekavist  
**Document Type:** Product Requirements / Software Requirements Specification  
**Project Methodology:** Waterfall  
**Primary Goal:** Build a centralized platform for managing Ekavist projects, teams, tasks, attendance, communication, documents, reporting, and project lifecycle.

---

# 1. Executive Summary

Ekavist will be a centralized project and team management platform designed to provide one source of truth for the organization.

The system will combine:

- Project management
- Waterfall project lifecycle management
- Work Breakdown Structure (WBS)
- Interactive Gantt charts
- Task management
- Team and role management
- Attendance and work sessions
- Individual employee dashboards
- Project Lead dashboards
- Project chat
- File and link sharing
- Google Drive integration
- Project and personal notes
- Notifications
- Email notifications
- RACI management
- Risks and issues
- Change requests
- Project reports
- Audit history
- Project closure and handover

The system should replace fragmented spreadsheets and communication channels with a structured project-management environment.

---

# 2. Product Vision

Ekavist should answer the following questions at any time:

- What projects are active?
- Who owns each project?
- Who is working on each project?
- Which Waterfall phase is active?
- What tasks are planned?
- Who is responsible for each task?
- What is the current progress?
- What is overdue?
- What is blocked?
- What deadlines are approaching?
- Which team members are working today?
- What was discussed in the project?
- What files and links were shared?
- What decisions were made?
- What risks and issues exist?
- What changes were requested?
- What has been completed?
- Is the project progressing according to the approved plan?

---

# 3. Core Design Principle

Ekavist must not be treated as simply:

> Excel + Chat + Attendance

It should be treated as:

> **A single source of truth for the complete lifecycle of every project.**

The complete project history should be traceable:

```text
Project Created
    ↓
Project Lead Assigned
    ↓
Team Assigned
    ↓
Requirements
    ↓
Planning
    ↓
Design
    ↓
Execution
    ↓
Testing
    ↓
Delivery
    ↓
Closure
```

Every stage should retain its tasks, documents, discussions, decisions, approvals, dates, responsible people, and history.

---

# 4. Project Methodology

Ekavist will use a **Waterfall project management model** as its primary methodology.

The default lifecycle should be:

1. Initiation
2. Requirements
3. Planning
4. Design
5. Execution / Development
6. Testing / Validation
7. Deployment / Delivery
8. Closure

Each phase should contain:

- Start date
- End date
- Owner
- Objectives
- Deliverables
- WBS items
- Tasks
- Dependencies
- Documents
- Milestones
- Risks
- Issues
- Approval / phase gate
- Completion status

---

# 5. Phase Gate Concept

A Waterfall phase should normally not be considered complete until its required work is completed and the phase is approved.

Example:

```text
Phase Work
    ↓
Required Tasks Completed?
    ↓
YES
    ↓
Phase Review
    ↓
Approved?
   / \
 YES  NO
  ↓    ↓
Next  Rework
Phase
```

Phase gates should be configurable.

A Project Lead should be able to define whether approval is required before the next phase begins.

---

# 6. User Roles

## 6.1 Super Admin / Company Admin

The Company Admin has organization-wide access.

Permissions:

- Create projects
- Edit projects
- Archive projects
- Assign Project Leads
- Create users
- Disable users
- Manage departments
- Manage roles
- Manage permissions
- View all projects
- View all attendance
- View reports
- Configure notifications
- Configure organization settings
- View audit logs

---

## 6.2 Project Lead

Project Leads manage individual projects.

Permissions:

- View assigned projects
- Add project members
- Remove project members
- Assign project roles
- Create phases
- Create WBS
- Create tasks
- Assign tasks
- Set deadlines
- Set priorities
- Set dependencies
- Update task status
- Update project progress
- Add project documents
- Add project notes
- Manage project chat
- Pin messages
- Manage milestones
- Manage risks
- Manage issues
- Create change requests
- Review member progress
- View project attendance
- Receive overdue alerts
- Approve phases where authorized
- Generate project reports

---

## 6.3 Team Member

Permissions:

- Login
- Start work session
- End work session
- View assigned projects
- View assigned tasks
- View deadlines
- Update task progress
- Update allowed task statuses
- Add task comments
- Upload task files
- Participate in project chat
- Share links
- Share Google Drive links
- Search project chat
- Filter chat resources
- Pin messages where permitted
- Create personal notes
- Create project notes where permitted
- View project documents
- View project information

Members should not modify project structure unless permission is explicitly granted.

---

## 6.4 Viewer / Stakeholder

Optional role.

Permissions:

- View selected projects
- View approved project information
- View reports
- View documents
- View selected chat channels if allowed

No editing permissions by default.

---

# 7. Organization Structure

```text
EKAVIST
│
├── Dashboard
├── My Work
├── Projects
├── Team
├── Attendance
├── Reports
└── Administration
```

Project structure:

```text
PROJECT
│
├── Overview
├── Dashboard
├── Phases
├── WBS
├── Tasks
├── Gantt
├── Team
├── RACI
├── Milestones
├── Documents
├── Chat
├── Notes
├── Risks
├── Issues
├── Change Requests
└── Reports
```

---

# 8. Authentication

The system must require authentication.

Minimum functionality:

- Email / username
- Password
- Login
- Logout
- Forgot password
- Password reset
- Account activation/deactivation
- Session management

Future:

- Google login
- Microsoft login
- Two-factor authentication
- Single Sign-On

---

# 9. User Management

Admin should be able to create and manage users.

User fields:

- User ID
- Full name
- Email
- Phone
- Profile photo
- Department
- Designation
- Organization role
- Account status
- Joining date
- Manager
- Skills
- Time zone
- Notification preferences

User status:

- Active
- Inactive
- Suspended

---

# 10. Project Creation

Admin creates a project.

Required fields:

- Project name
- Project code
- Description
- Project Lead
- Start date
- Planned completion date
- Priority
- Project category
- Client / department
- Objectives
- Expected deliverables

Optional:

- Budget
- Project location
- External stakeholder
- Important links
- Project logo/image
- Project template

---

# 11. Project Status

Recommended statuses:

- Draft
- Planned
- Active
- On Hold
- At Risk
- Completed
- Cancelled
- Archived

---

# 12. Project Dashboard

Every project must have a dashboard.

Example:

```text
PROJECT: AI-BASED ELECTRONIC WEEDER

Overall Progress: 74%

Current Phase: Execution

Start Date: 01 Sep
Target Date: 30 Nov

Tasks
Total: 82
Completed: 59
In Progress: 14
Not Started: 5
Blocked: 2
Overdue: 2

Team Members: 8
```

Dashboard widgets:

- Overall progress
- Current phase
- Upcoming deadlines
- Overdue tasks
- Blocked tasks
- Completed tasks
- Team progress
- Phase progress
- Milestones
- Risks
- Issues
- Recent activity
- Recent chat messages
- Important documents

---

# 13. Waterfall Phases

Each project should have configurable phases.

Default phases:

```text
1. Initiation
2. Requirements
3. Planning
4. Design
5. Execution
6. Testing
7. Deployment
8. Closure
```

Each phase should have:

- Phase ID
- Phase name
- Description
- Owner
- Start date
- End date
- Status
- Progress
- Deliverables
- Tasks
- Documents
- Approval requirement
- Approval status

---

# 14. Phase Status

Recommended statuses:

- Not Started
- In Progress
- Under Review
- Approved
- Blocked
- Rework Required
- Completed
- Cancelled

---

# 15. Work Breakdown Structure

The WBS is a core feature.

Example:

```text
1.0 Initiation
    1.1 Project Charter
    1.2 Stakeholder Identification
    1.3 Project Kickoff

2.0 Planning
    2.1 Requirements
    2.2 Architecture
    2.3 Resource Planning
    2.4 Design Approval

3.0 Execution
    3.1 Development
    3.2 Integration
    3.3 Internal Testing

4.0 Validation
    4.1 Testing
    4.2 Bug Fixing
    4.3 Validation

5.0 Closure
    5.1 Final Documentation
    5.2 Handover
    5.3 Project Closure
```

WBS items should support hierarchy.

A WBS item may contain:

- Child WBS items
- Tasks
- Owner
- Dates
- Progress
- Dependencies
- Deliverables

---

# 16. Task Management

Task fields:

- Task ID
- Task name
- Description
- Project
- Phase
- WBS ID
- Assigned user
- Responsible role
- Accountable user
- Start date
- Due date
- Estimated hours
- Actual hours
- Progress percentage
- Priority
- Status
- Dependencies
- Attachments
- Comments
- Created by
- Created date
- Updated date

---

# 17. Task Status

Initial statuses:

- Not Started
- In Progress
- Blocked
- Under Review
- Completed
- Cancelled

---

# 18. Task Priority

- Low
- Medium
- High
- Critical

---

# 19. Task Progress

Progress should be represented as percentage:

```text
0%
10%
25%
50%
75%
90%
100%
```

A task marked Completed should normally automatically become 100%.

---

# 20. Task Dependencies

Support dependencies between tasks.

Example:

```text
Requirements
      ↓
Architecture
      ↓
Development
      ↓
Testing
      ↓
Deployment
```

Supported dependency types can initially be:

- Finish-to-Start

Future:

- Start-to-Start
- Finish-to-Finish
- Start-to-Finish

The system should warn when a user attempts to start a task whose predecessor is incomplete.

---

# 21. Milestones

Milestones represent major project events.

Examples:

- Requirements Approved
- Design Approved
- Development Complete
- Testing Complete
- Client Approval
- Production Deployment

Milestone fields:

- Name
- Description
- Date
- Owner
- Status
- Related phase
- Related tasks

---

# 22. Interactive Gantt Chart

The Gantt chart should replace the static spreadsheet view.

Columns:

- WBS ID
- Task
- Owner
- Start
- End
- Duration
- Status
- Progress
- Dependency

Timeline:

```text
Sep        Oct        Nov        Dec
│----------│----------│----------│
████████
      █████████
              █████████████
                         ██████
```

Features:

- Zoom
- Day/week/month view
- Expand/collapse WBS
- Task dependencies
- Milestones
- Progress
- Status
- Deadline highlighting
- Phase grouping

Changing task dates should update the Gantt automatically.

---

# 23. Team Allocation

Each project should have a Team section.

Display:

```text
Member
Role
Department
Assigned Tasks
Completed Tasks
Current Work
Progress
Availability
```

Project Lead should be able to:

- Add member
- Remove member
- Assign project role
- Assign responsibilities
- Assign tasks

---

# 24. RACI Matrix

Support:

- Responsible
- Accountable
- Consulted
- Informed

Example:

| Task         | Project Lead | Engineer | Developer | QA  |
| ------------ | ------------ | -------- | --------- | --- |
| Requirements | A            | R        | C         | I   |
| Architecture | A            | R        | C         | C   |
| Development  | A            | C        | R         | I   |
| Testing      | A            | C        | C         | R   |

RACI should be available at task or WBS level.

---

# 25. Employee Dashboard

Every team member should have an independent dashboard.

Example:

```text
MY DASHBOARD

Attendance
09:30 AM
Working

Today's Tasks
5

Completed
2

In Progress
2

Overdue
1

Upcoming
6
```

Sections:

- My Projects
- Today's Tasks
- Upcoming Tasks
- Overdue Tasks
- My Progress
- My Attendance
- My Notes
- Notifications
- Recent Messages

---

# 26. My Work

Dedicated section:

```text
My Work
│
├── Today
├── Upcoming
├── Overdue
├── Completed
├── My Projects
├── My Notes
└── My Attendance
```

---

# 27. Daily Work Flow

Recommended flow:

```text
Login
  ↓
Dashboard
  ↓
Start Work
  ↓
Attendance Session Starts
  ↓
View Today's Tasks
  ↓
Work on Task
  ↓
Update Progress
  ↓
Add Comment / Evidence
  ↓
Complete Task
  ↓
End Work
  ↓
Attendance Session Ends
```

Important distinction:

```text
Login ≠ Attendance

Login = Authentication
Start Work = Work Session
```

---

# 28. Attendance Management

Attendance fields:

- Date
- User
- Login time
- Start work time
- Logout time
- Total work duration
- Break duration
- Attendance status

Statuses:

- Present
- Late
- Half Day
- Leave
- Absent
- Holiday

---

# 29. Work Sessions

A work session should record:

- User
- Project
- Task
- Start time
- End time
- Duration

Future feature:

Allow users to switch between tasks while keeping attendance active.

---

# 30. Break Management

Optional initial feature.

```text
Working
 ↓
Start Break
 ↓
Break
 ↓
End Break
 ↓
Working
```

Break duration should not count as active work duration.

---

# 31. Project Chat

Every project should have a dedicated chat interface.

Chat should be project-specific.

Basic features:

- Text messages
- Replies
- Attachments
- Links
- Google Drive links
- Mentions
- Reactions
- Pinning

---

# 32. Chat Search

Search should support:

- Message text
- User
- Date
- File
- Link
- Keyword

Example:

```text
Search: "architecture"

Results:
Messages
Files
Links
```

---

# 33. Chat Filters

Filters:

- All
- Messages
- Files
- Links
- Google Drive
- Pinned
- My Messages
- Date range
- User

---

# 34. Pinned Messages

Project members with permission can pin important messages.

Examples:

- Important decisions
- Meeting links
- Project instructions
- Requirements
- Deadlines
- Important resources

Pinned messages should have a dedicated view.

---

# 35. Shared Resources

Create a project-level resource library.

```text
Shared Resources

Google Drive
Web Links
Documents
Files
Pinned Resources
```

Each resource should contain:

- Name
- URL
- Type
- Added by
- Date
- Related task
- Related phase

---

# 36. Google Drive

Initially, Ekavist should use Google Drive for file storage.

Ekavist should store references to Drive resources.

Example:

```text
Project
  ↓
Documents
  ↓
Google Drive Link
```

Future integration:

- Google OAuth
- Drive API
- File picker
- Permission-aware file access
- Folder integration

---

# 37. Documents

Project documents should be categorized.

Example:

```text
Project Documents

Requirements
Design
Development
Testing
Reports
Meeting Documents
Final Deliverables
```

Document fields:

- Name
- Category
- URL
- File type
- Version
- Uploaded/shared by
- Date
- Related phase
- Related task

---

# 38. Notes

Two note types:

## Personal Notes

Only the user can see them.

Examples:

- Reminders
- Ideas
- Questions
- Follow-ups

## Project Notes

Visible to authorized project members.

Examples:

- Decisions
- Meeting notes
- Important instructions
- Project knowledge

---

# 39. Decision Log

Recommended feature.

Every important decision should be recorded.

Fields:

- Decision
- Date
- Description
- Decision maker
- Related phase
- Related task
- Reason
- Supporting document

This becomes valuable during project reviews and closure.

---

# 40. Notifications

Notification channels:

1. In-app
2. Email

Future:

3. Browser notifications
4. Mobile push notifications

Notifications should include:

- New task assignment
- Task deadline
- Overdue task
- Mention
- New project assignment
- Phase approval
- Phase rejection
- New message
- Pinned message
- Change request
- Risk assignment
- Issue assignment

---

# 41. Deadline Notification Rules

Default:

```text
3 days before
    ↓
Reminder

1 day before
    ↓
Reminder

Due date
    ↓
Due today

After deadline
    ↓
Overdue

Repeated overdue
    ↓
Project Lead escalation
```

Notification rules should be configurable.

---

# 42. Email Notifications

Email templates should exist for:

- Task assigned
- Task due soon
- Task overdue
- Project assigned
- Mention
- Phase approval required
- Phase approved
- Phase rejected
- New project member
- Change request
- Risk
- Issue

---

# 43. Project Lead Alerts

Project Lead should receive alerts such as:

> 4 tasks are overdue in Project X.

> 2 tasks are blocked.

> Phase 3 has reached its planned completion date.

> 3 members have tasks due today.

---

# 44. Risks

Each project should have a Risk Register.

Fields:

- Risk ID
- Risk
- Description
- Probability
- Impact
- Severity
- Owner
- Mitigation
- Contingency
- Status
- Due date
- Related phase
- Related task

Statuses:

- Open
- Monitoring
- Mitigated
- Closed
- Occurred

---

# 45. Issues

Issues are actual problems rather than possible future risks.

Fields:

- Issue ID
- Title
- Description
- Priority
- Owner
- Date identified
- Target resolution
- Status
- Resolution
- Related task
- Related phase

Statuses:

- Open
- Investigating
- In Progress
- Resolved
- Closed

---

# 46. Change Requests

Waterfall projects need controlled change management.

Workflow:

```text
Change Requested
       ↓
Impact Analysis
       ↓
Time Impact
Resource Impact
Cost Impact
Schedule Impact
       ↓
Approval
       ↓
Approved?
   /       \
 Yes        No
 ↓          ↓
Update     Reject
Project
Plan
```

Change Request fields:

- CR ID
- Request title
- Description
- Requester
- Date
- Reason
- Impact
- Additional effort
- Additional resources
- Schedule impact
- Approval status
- Approver
- Decision date

---

# 47. Project Reports

Reports should include:

## Daily

- Tasks completed
- Tasks started
- Tasks overdue
- Blocked tasks
- Member activity

## Weekly

- Overall progress
- Planned vs actual
- Completed tasks
- Overdue tasks
- Blocked tasks
- Phase progress
- Risks
- Issues
- Next week's priorities

## Project Completion

- Planned duration
- Actual duration
- Tasks planned
- Tasks completed
- Delayed tasks
- Deliverables
- Major decisions
- Change requests
- Risks
- Issues
- Final documentation
- Handover

---

# 48. Work Distribution Dashboard

Based on the project trackers, show work distribution.

Example:

| Member   | Total Tasks | Completed | In Progress | Not Started |
| -------- | ----------: | --------: | ----------: | ----------: |
| Member A |          15 |        10 |           3 |           2 |
| Member B |          12 |         7 |           4 |           1 |
| Member C |          20 |        14 |           3 |           3 |

This can reveal uneven workload.

---

# 49. Workstream Dashboard

Show:

```text
Workstream
Total
Completed
In Progress
Not Started
Overdue
```

Example:

| Workstream  | Total | Completed | In Progress | Not Started |
| ----------- | ----: | --------: | ----------: | ----------: |
| Research    |    15 |        10 |           3 |           2 |
| Design      |    20 |        12 |           5 |           3 |
| Development |    30 |        15 |           8 |           7 |
| Testing     |    18 |         4 |           6 |           8 |

---

# 50. Company Dashboard

Company-wide dashboard:

```text
EKAVIST

Active Projects: 8
On Schedule: 5
Attention Required: 2
Delayed: 1

Total Employees: 32
Working Today: 26

Total Tasks: 427
Completed: 281
In Progress: 76
Overdue: 8
Blocked: 11
```

Widgets:

- Project status
- Team attendance
- Project progress
- Overdue tasks
- Upcoming milestones
- Risks
- Issues
- Recent activity

---

# 51. Project Health

Project health should be based on measurable project conditions rather than a subjective rating.

Indicators:

```text
Schedule
Tasks
Dependencies
Phase Gate
Overdue Tasks
Risks
Issues
```

Example:

```text
Schedule          OK
Tasks             Attention
Dependencies      OK
Phase Gate        OK
Overdue Tasks     Attention
Risks             OK
Issues            Attention
```

---

# 52. Schedule Metrics

Initial metrics:

- Planned progress
- Actual progress
- Schedule variance
- Task completion percentage
- Phase completion percentage
- Overdue count

Future:

- Earned Value
- Planned Value
- Actual Cost
- SPI
- CPI
- EVM reports

---

# 53. SPI

Future version may support:

```text
SPI = Earned Value / Planned Value
```

This should not be mandatory for the first release.

---

# 54. Audit Log

Every important action should be recorded.

Examples:

```text
Vishal created Project A
Kunal was added to Project A
Task #123 assigned to Kunal
Task #123 deadline changed
Task #123 marked completed
Document added
Phase approved
Change request approved
```

Audit fields:

- User
- Action
- Entity
- Entity ID
- Old value
- New value
- Timestamp
- IP/device metadata where legally appropriate

---

# 55. Activity Feed

Each project should have an activity feed.

Examples:

```text
09:45 Vishal assigned Task #123 to Kunal
10:20 Kunal updated Task #123 to 50%
11:10 Akshata uploaded Test Report
12:15 Vishal approved Phase 2
```

---

# 56. Search

Global search should eventually cover:

- Projects
- Users
- Tasks
- Documents
- Messages
- Notes
- Risks
- Issues
- Change Requests

Project-level search should focus on project data.

---

# 57. Permissions

Use role-based access control.

Example:

```text
Admin
 ↓
Organization Permissions

Project Lead
 ↓
Project Permissions

Team Member
 ↓
Assigned Work Permissions
```

Permissions should be granular enough to support:

- View
- Create
- Edit
- Delete
- Assign
- Approve
- Manage
- Export

---

# 58. Suggested Database Entities

Core entities:

```text
User
Department
OrganizationRole
Permission

Project
ProjectMember
ProjectRole

Phase
PhaseGate
WBS
Task
TaskAssignment
TaskDependency
Milestone

Attendance
WorkSession
BreakSession

Message
MessageReply
MessageAttachment
MessageReaction
PinnedMessage

Document
DocumentLink
GoogleDriveLink

PersonalNote
ProjectNote
DecisionLog

Risk
Issue
ChangeRequest

Notification
EmailNotification

ProjectReport
AuditLog
ActivityLog
```

---

# 59. Core Relationships

```text
Organization
   │
   ├── Users
   │
   └── Projects
          │
          ├── Project Members
          │
          ├── Phases
          │      │
          │      └── WBS
          │             │
          │             └── Tasks
          │                    │
          │                    ├── Assignments
          │                    ├── Dependencies
          │                    └── Attachments
          │
          ├── Documents
          ├── Chat
          ├── Notes
          ├── Risks
          ├── Issues
          ├── Change Requests
          └── Reports
```

---

# 60. Recommended Technical Architecture

The exact technology can be decided later, but the application should be designed as a modular web application.

Recommended architecture:

```text
Frontend
    ↓
API Layer
    ↓
Business Logic
    ↓
Database
    ↓
External Services
```

External services:

```text
Google Drive
Email Provider
Authentication Provider
Future Notifications
```

---

# 61. Frontend Requirements

Frontend should be:

- Responsive
- Desktop-first
- Tablet-friendly
- Mobile-friendly
- Fast
- Accessible

Primary navigation:

```text
Dashboard
My Work
Projects
Team
Attendance
Reports
Notifications
Settings
```

---

# 62. Backend Requirements

Backend should handle:

- Authentication
- Authorization
- Users
- Projects
- Tasks
- Waterfall phases
- Gantt calculations
- Attendance
- Chat
- Notifications
- Documents
- Reports
- Audit logging

Business logic should stay on the server rather than being implemented only in the frontend.

---

# 63. Real-Time Chat

Project chat should ideally support real-time updates.

Possible architecture:

```text
User A
   ↓
Chat API / WebSocket
   ↓
Message Service
   ↓
Database
   ↓
User B
```

Future:

- Typing indicator
- Online status
- Read receipts
- Presence
- Reactions

---

# 64. Notification Architecture

Use a central notification service.

```text
Event
 ↓
Notification Engine
 ↓
Determine Recipients
 ↓
In-App Notification
 ↓
Email Notification
```

Example:

```text
Task becomes overdue
        ↓
Notification Engine
        ↓
Task Owner
Project Lead
        ↓
In-App + Email
```

---

# 65. File Storage Strategy

Initial recommendation:

- Store actual files in Google Drive or another dedicated storage provider.
- Store metadata and references in Ekavist.

Do not build a complicated file-storage system into V1 unless there is a clear requirement.

---

# 66. Data Import

The existing Excel project trackers should be importable.

Possible import data:

- Project information
- Phases
- WBS
- Tasks
- Start dates
- End dates
- Owners
- Work distribution
- RACI
- Milestones

Import flow:

```text
Upload Excel
    ↓
Map Columns
    ↓
Validate Data
    ↓
Show Preview
    ↓
Confirm Import
    ↓
Create Project Data
```

---

# 67. Excel Data Mapping

Example:

```text
Excel Column
     ↓
Ekavist Field

Project Name → Project.name
WBS → WBS.code
Task → Task.name
Start Date → Task.start_date
End Date → Task.due_date
Owner → Task.assignee
Status → Task.status
Progress → Task.progress
Predecessor → TaskDependency
Role → ProjectRole / RACI
```

---

# 68. Data Validation During Import

System should detect:

- Missing project names
- Invalid dates
- Missing owners
- Duplicate tasks
- Unknown users
- Invalid dependencies
- Invalid status values
- Circular dependencies

The user should be shown errors before import.

---

# 69. Security

Minimum security requirements:

- Password hashing
- Secure sessions
- HTTPS
- Role-based authorization
- Input validation
- Output escaping
- CSRF protection where applicable
- Rate limiting
- Secure file handling
- Audit logs
- Secure API authentication
- Permission checks on every protected resource

---

# 70. Privacy

The system contains employee information.

Therefore:

- Users should only see permitted employee data.
- Personal notes should remain private.
- Attendance should be restricted to authorized users.
- Project chat should respect project membership.
- Documents should respect permissions.

---

# 71. Backup

Database backup:

- Automated
- Scheduled
- Retained according to company policy

Important project information should be recoverable.

Audit logs should have appropriate retention.

---

# 72. Error Handling

The system should never silently fail.

Examples:

```text
Unable to save task.
Please try again.

Unable to send message.
Your message has not been lost.
```

API errors should be logged.

---

# 73. Testing Strategy

Every module should have:

- Unit tests
- Integration tests
- API tests
- Permission tests
- UI tests
- Regression tests

Critical workflows should have end-to-end tests.

---

# 74. Critical Test Cases

## Authentication

- Valid login
- Invalid password
- Disabled account
- Password reset
- Session expiry

## Projects

- Create project
- Assign Project Lead
- Add member
- Remove member
- Archive project

## Tasks

- Create task
- Assign task
- Change status
- Update progress
- Complete task
- Overdue task
- Dependency validation

## Attendance

- Start work
- End work
- Break
- Multiple sessions
- Duplicate session prevention

## Chat

- Send message
- Reply
- Attach file
- Share link
- Search
- Pin
- Filter

## Permissions

- Admin access
- Lead access
- Member access
- Viewer access
- Unauthorized access rejection

---

# 75. MVP

The first production version should include:

## Authentication

- Login
- Logout
- Password reset

## Users

- User management
- Roles
- Permissions

## Projects

- Create project
- Project Lead
- Members
- Project overview

## Waterfall

- Phases
- Phase dates
- Phase status
- Phase gates

## Work Management

- WBS
- Tasks
- Assignment
- Deadlines
- Status
- Progress
- Dependencies

## Gantt

- Interactive Gantt
- Phase grouping
- Dependencies
- Progress

## Dashboards

- Company dashboard
- Project Lead dashboard
- Employee dashboard

## Attendance

- Start work
- End work
- Attendance records

## Notifications

- In-app
- Email
- Deadline alerts
- Overdue alerts

## Communication

- Project chat
- File/link sharing
- Search
- Pin
- Filters

## Documents

- Project document links
- Google Drive links

## Notes

- Personal notes
- Project notes

---

# 76. Version 2

After MVP:

- RACI
- Risks
- Issues
- Change Requests
- Decision Log
- Advanced reports
- Activity feed
- Advanced Gantt
- Workload analytics
- Resource allocation
- Google Drive API integration
- Advanced email templates

---

# 77. Version 3

Potential advanced functionality:

- Mobile applications
- Push notifications
- SSO
- Google Workspace integration
- Microsoft 365 integration
- Calendar integration
- Advanced EVM
- SPI
- CPI
- Resource forecasting
- AI project assistant
- Automatic project summaries
- Automatic overdue-risk detection
- AI-generated weekly reports

---

# 78. AI Features for the Future

AI should be added only after the core system is stable.

Potential features:

### AI Project Summary

Generate:

> "Project is 67% complete. Three tasks are overdue. Testing is currently behind schedule."

### AI Meeting Summary

Convert project meeting discussions into:

- Summary
- Decisions
- Tasks
- Owners
- Deadlines

### AI Risk Detection

Detect patterns such as:

- Repeated deadline extensions
- Increasing blocked tasks
- Unbalanced workload
- Phase delays

### AI Weekly Report

Automatically generate:

- Completed work
- Pending work
- Risks
- Issues
- Next priorities

AI should assist project managers, not silently change project data.

---

# 79. Recommended Navigation

```text
┌─────────────────────────────┐
│ EKAVIST                     │
├─────────────────────────────┤
│ Dashboard                   │
│ My Work                     │
│ Projects                    │
│ Team                        │
│ Attendance                  │
│ Reports                     │
│ Notifications               │
│                             │
│ Administration              │
│ Settings                    │
└─────────────────────────────┘
```

---

# 80. Project Navigation

```text
Project
│
├── Overview
├── Dashboard
├── Phases
├── WBS
├── Tasks
├── Gantt
├── Team
├── RACI
├── Milestones
├── Documents
├── Chat
├── Notes
├── Decisions
├── Risks
├── Issues
├── Change Requests
└── Reports
```

---

# 81. Core Business Rules

1. Every project must have a Project Lead.
2. A project cannot become Active without a Project Lead.
3. Only authorized users can add project members.
4. Tasks must belong to a project.
5. Tasks should normally belong to a phase.
6. Completed tasks should have 100% progress.
7. A task cannot be completed without required information if the project defines completion criteria.
8. Overdue tasks should automatically be detected.
9. Project Leads should receive overdue notifications.
10. Phase gates should control Waterfall progression where enabled.
11. Members should only see projects they are authorized to access.
12. Personal notes must remain private.
13. Project notes follow project permissions.
14. Chat access follows project membership.
15. Important actions must be recorded in the audit log.
16. Login and attendance should remain separate concepts.
17. Project changes should be traceable.
18. Change Requests should be used for controlled scope changes.
19. Project closure should require required closure deliverables.
20. Archived projects should be read-only by default.

---

# 82. Project Closure

Closure workflow:

```text
All Tasks Completed
        ↓
Final Testing
        ↓
Deliverables Completed
        ↓
Documentation Completed
        ↓
Handover
        ↓
Final Review
        ↓
Project Closure Approval
        ↓
Project Completed
        ↓
Archive
```

Closure checklist:

- Final deliverables
- Final documentation
- Open issues resolved
- Outstanding risks reviewed
- Change requests closed
- Handover completed
- Final report generated
- Lessons learned recorded

---

# 83. Lessons Learned

Every completed project should allow:

- What went well?
- What went wrong?
- What should be changed?
- What should be repeated?
- Technical lessons
- Process lessons
- Team lessons

This creates organizational knowledge over time.

---

# 84. Future Resource Management

Eventually Ekavist should be able to answer:

```text
Who is available?
Who is overloaded?
Who is assigned to multiple projects?
Who has capacity next month?
```

This can be built after the core task system.

---

# 85. Future Calendar

Optional integration:

```text
Calendar
│
├── Task deadlines
├── Milestones
├── Meetings
├── Phase dates
└── Leave
```

---

# 86. Future Leave Management

Potential module:

- Leave request
- Approval
- Leave balance
- Holidays
- Team calendar
- Absence impact on project schedules

---

# 87. Non-Functional Requirements

The application should be:

- Reliable
- Secure
- Responsive
- Maintainable
- Scalable
- Accessible
- Testable
- Modular

The architecture should allow future mobile apps and integrations without rewriting the core system.

---

# 88. Performance

The system should remain responsive with:

- Hundreds of projects
- Thousands of users
- Large task databases
- Large chat histories
- Large document metadata collections

Pagination, indexing, caching, and efficient queries should be used where appropriate.

---

# 89. Auditability

For important project-management actions, the system should retain:

```text
Who
What
When
Before
After
```

Example:

```text
User: Vishal
Action: Changed Task Deadline
Task: T-102
Old Date: Sep 28
New Date: Oct 02
Time: Sep 27 10:32
```

---

# 90. Project Activity Timeline

Each project should maintain a timeline:

```text
Sep 01
Project created

Sep 03
Project Lead assigned

Sep 05
Requirements phase started

Sep 12
Requirements approved

Sep 15
Design started

Sep 22
Design approved

Sep 25
Development started
```

This is useful for management and project history.

---

# 91. Suggested Development Order

Development should follow this order:

```text
1. Architecture
        ↓
2. Database
        ↓
3. Authentication
        ↓
4. User / Role Management
        ↓
5. Project Management
        ↓
6. Waterfall Phases
        ↓
7. WBS
        ↓
8. Tasks
        ↓
9. Dependencies
        ↓
10. Gantt
        ↓
11. Dashboards
        ↓
12. Attendance
        ↓
13. Notifications
        ↓
14. Chat
        ↓
15. Documents
        ↓
16. Notes
        ↓
17. Reports
        ↓
18. Risks / Issues
        ↓
19. Change Requests
        ↓
20. Advanced Features
```

---

# 92. Definition of Done for MVP

Ekavist MVP should be considered complete only when:

- Admin can create users.
- Admin can create projects.
- Admin can assign Project Leads.
- Project Leads can add members.
- Project Leads can create Waterfall phases.
- Project Leads can create WBS.
- Project Leads can create and assign tasks.
- Tasks support deadlines.
- Tasks support dependencies.
- Members can see their assigned tasks.
- Members can update progress.
- Overdue tasks are detected.
- Project Leads receive overdue notifications.
- Members can start/end work sessions.
- Attendance is recorded.
- Project has an interactive dashboard.
- Employee has an individual dashboard.
- Project has an interactive Gantt.
- Project has chat.
- Chat supports search.
- Chat supports pinning.
- Chat supports link/file sharing.
- Google Drive links can be shared.
- Project notes work.
- Basic reports work.
- Permissions work correctly.
- Audit logging works.
- Critical workflows have automated tests.

---

# 93. Success Criteria

Ekavist should reduce the need for:

- Separate project spreadsheets
- Separate task spreadsheets
- Separate attendance sheets
- Scattered project conversations
- Searching through emails for project decisions
- Searching through chat for important files
- Manually calculating project progress
- Manually identifying overdue work

The desired outcome is:

```text
One Company
      ↓
One Platform
      ↓
One Project Record
      ↓
One Source of Truth
```

---

# 94. Final Product Model

The final Ekavist ecosystem should look like:

```text
                         EKAVIST
                            │
             ┌──────────────┼──────────────┐
             │              │              │
          PEOPLE         PROJECTS       REPORTS
             │              │
       ┌─────┼─────┐        │
       │     │     │        │
     Admin Lead Member       │
                            │
                  ┌─────────┼─────────┐
                  │         │         │
                Waterfall  Team      Chat
                  │         │         │
              ┌───┼───┐     │     ┌───┼───┐
              │   │   │     │     │   │   │
             WBS Tasks Gantt     Files Links Search
                  │
              Dependencies
                  │
             Progress
                  │
             Deadlines
                  │
             Notifications
                  │
             Reports
```

---

# 95. Final Product Philosophy

The most important design principle is:

> **Every project action should connect back to the project.**

A task should know its project.

A task should know its phase.

A phase should know its WBS.

A task should know its owner.

A chat discussion should be associated with the project.

A document should be associated with the project.

A risk should be associated with the project.

An issue should be associated with the project.

A change request should be associated with the project.

A report should be generated from the actual project data.

This will make Ekavist a proper project-management platform rather than another collection of disconnected tools.

---

# 96. Recommended Immediate Development Documents

Before development begins, create these documents:

1. `EKAVIST_PRD.md`
2. `EKAVIST_SRS.md`
3. `EKAVIST_ARCHITECTURE.md`
4. `EKAVIST_DATABASE_SCHEMA.md`
5. `EKAVIST_API_SPECIFICATION.md`
6. `EKAVIST_UI_UX_SPECIFICATION.md`
7. `EKAVIST_PERMISSIONS.md`
8. `EKAVIST_WATERFALL_WORKFLOW.md`
9. `EKAVIST_NOTIFICATION_RULES.md`
10. `EKAVIST_TEST_PLAN.md`
11. `EKAVIST_MVP_ROADMAP.md`
12. `EKAVIST_EXCEL_IMPORT_SPEC.md`

These documents together should become the development blueprint for Ekavist.
