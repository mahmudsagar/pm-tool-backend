# Notification System Documentation

## Overview

The notification system automatically sends notifications to relevant users when entities (pages, boards, documents, etc.) are created, updated, or deleted. Notifications are sent based on the entity's sharing settings.

## How It Works

### Notification Recipients

Recipients are determined based on the entity's sharing configuration:

1. **Private Entities** (`is_private: true`)
   - Notifies the owner
   - Notifies all users in `shared_members` array

2. **Public Entities with Specific Sharing** (`is_private: false`, with `shared_members` or `shared_teams`)
   - Notifies users in `shared_members` array
   - Notifies all members of teams in `shared_teams` array

3. **Completely Public Entities** (`is_private: false`, no specific sharing)
   - Notifies all workspace members

The user who performed the action is always excluded from receiving their own notifications.

## API Endpoints

### Get Notifications

**Endpoint:** `GET /v1/notification`

**Query Parameters:**
- `limit` (optional, default: 50) - Number of notifications to fetch
- `skip` (optional, default: 0) - Number of notifications to skip (for pagination)

**Response:**
```json
{
  "status": "success",
  "message": "Notifications fetched successfully",
  "data": {
    "notifications": [
      {
        "_id": "notification_id",
        "workspace_id": "workspace_id",
        "recipient_id": "user_id",
        "actor_id": "user_id",
        "action": "create",
        "entity_type": "board",
        "entity_id": "board_id",
        "entity_name": "Board Name",
        "message": "Created a new board: Board Name",
        "metadata": {
          "actor_name": "John Doe"
        },
        "is_read": false,
        "createdAt": "2026-04-25T10:30:00Z",
        "updatedAt": "2026-04-25T10:30:00Z"
      }
    ],
    "count": {
      "total": 10,
      "unread": 3
    }
  }
}
```

### Mark Notification as Read

**Endpoint:** `GET /v1/notification/markAsRead`

**Query Parameters:**
- `notification_id` (required) - ID of the notification to mark as read

**Response:**
```json
{
  "status": "success",
  "message": "Notification marked as read",
  "data": {
    "_id": "notification_id",
    "is_read": true,
    "read_at": "2026-04-25T10:35:00Z"
  }
}
```

## Supported Actions

- **create** - Sent when an entity is created
- **update** - Sent when an entity is updated
- **delete** - Sent when an entity is deleted
- **share** - Sent when an entity's sharing settings change
- **comment** - Sent when someone comments on an entity

## Supported Entity Types

- `board` - Kanban boards
- `page` - Regular pages
- `document` - Document pages
- `sheet` - Spreadsheet pages
- `whiteboard` - Whiteboard pages
- `folder` - Folders
- `space` - Spaces
- `group` - Groups
- `comment` - Comments

## Notification Metadata

The `metadata` field can contain additional context:
- `actor_name` - Name of the user who performed the action
- `changes` - Array of fields that were changed (for update actions)
- `words` - Word count (for document updates)
- `preview` - Text preview (for document updates)

## Database Schema

The `Notification` collection has the following fields:

```javascript
{
  _id: String,                    // Unique notification ID
  workspace_id: String,           // Workspace ID
  recipient_id: String,           // User ID who receives the notification
  actor_id: String,               // User ID who performed the action
  action: String,                 // 'create', 'update', 'delete', 'share', 'comment'
  entity_type: String,            // Type of entity
  entity_id: String,              // ID of the entity
  entity_name: String,            // Name/title of the entity (for display)
  message: String,                // Notification message
  metadata: Object,               // Additional context
  is_read: Boolean,               // Whether the notification has been read
  read_at: Date,                  // When the notification was marked as read
  createdAt: Date,                // When the notification was created
  updatedAt: Date                 // When the notification was last updated
}
```

## Integration with Frontend

To integrate notifications into your frontend:

1. **Fetch notifications on load:**
   ```javascript
   const response = await fetch('/v1/notification?limit=20');
   const { data } = await response.json();
   const { notifications, count } = data;
   ```

2. **Display unread count:**
   ```javascript
   const unreadCount = count.unread;
   // Display badge with unreadCount
   ```

3. **Mark as read when viewed:**
   ```javascript
   await fetch(`/v1/notification/markAsRead?notification_id=${notificationId}`);
   ```

4. **Real-time updates (optional):**
   - Implement WebSocket connection to receive notifications in real-time
   - Poll `/v1/notification` at intervals (e.g., every 30 seconds)

## Examples

### When a Board is Created

If user A creates a public board shared with team B:
- All members of team B receive a notification: "User A created a new board: Board Name"

### When a Document is Updated

If user A updates a private document shared with users B and C:
- Users B and C receive a notification: "User A updated document: Document Name"

### When a Board is Deleted

If user A deletes a public board:
- All workspace members receive a notification: "User A deleted board: Board Name"
