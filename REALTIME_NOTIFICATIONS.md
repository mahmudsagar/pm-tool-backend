# Real-time Notifications System

This document describes the real-time notification system using WebSockets.

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                         Frontend (React)                          │
│                                                                   │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │         NotificationCenter Component                     │   │
│  │  ┌────────────────────────────────────────────────────┐  │   │
│  │  │  useNotifications() Hook                           │  │   │
│  │  │  - Fetches notifications via API                  │  │   │
│  │  │  - Manages real-time updates via WebSocket        │  │   │
│  │  │  - Handles marking as read                        │  │   │
│  │  └────────────────────────────────────────────────────┘  │   │
│  │                      │                                     │   │
│  │  ┌──────────────────▼──────────────────┐                 │   │
│  │  │  useRealtimeNotifications Hook      │                 │   │
│  │  │  - Manages Socket.io connection    │                 │   │
│  │  │  - Listens for 'notification' event│                 │   │
│  │  └──────────────────────────────────────┘                │   │
│  └──────────────────────────────────────────────────────────┘   │
│                                                                   │
│         │                                                        │
│         │ WebSocket (Socket.io)                                │
│         │                                                        │
└─────────┼────────────────────────────────────────────────────────┘
          │
          │ TCP/WebSocket Connection
          │
┌─────────▼────────────────────────────────────────────────────────┐
│                    Backend (Node.js)                              │
│                                                                   │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │         WebSocket Server (Socket.io on Port 3002)       │   │
│  │                                                          │   │
│  │  Rooms:                                                │   │
│  │  - user:{userId}       (Per-user notifications)        │   │
│  │  - workspace:{wsId}    (Workspace-wide events)         │   │
│  └──────────────────────────────────────────────────────────┘   │
│                          │                                       │
│         ┌────────────────┴────────────────┐                     │
│         │                                 │                     │
│  ┌──────▼────────┐            ┌──────────▼──────────┐          │
│  │ Notification  │            │  REST API Endpoint  │          │
│  │ Service       │            │  POST /v1/board     │          │
│  │ (Database)    │            │  PUT /v1/board      │          │
│  │               │            │  DELETE /v1/board   │          │
│  │ - Create      │            │  etc.               │          │
│  │ - Save        │            └─────────────────────┘          │
│  │ - Emit        │                                              │
│  └──────────────┘                                               │
│                                                                   │
└───────────────────────────────────────────────────────────────────┘
```

## Server Setup

### 1. WebSocket Server Initialization

The WebSocket server is initialized in `server.js`:

```javascript
import { initializeWebSocket } from './modules/v1/utils/websocketService.js';

// In startServer():
const httpServer = http.createServer();
const wsPort = process.env.WS_PORT || 3002;
initializeWebSocket(httpServer);
httpServer.listen(wsPort);
```

### 2. WebSocket Port Configuration

Add to your `.env`:
```env
WS_PORT=3002
FRONTEND_URL=http://localhost:3000
```

### 3. Notification Broadcasting

When notifications are created, they're automatically broadcast:

```javascript
// notificationService.js
await createNotification({
    workspaceId,
    entity,
    entityType,
    action,
    currentUserId,
    metadata
});
// Automatically emits via WebSocket to recipients
```

## Frontend Integration

### 1. Install Socket.io Client

```bash
npm install socket.io-client
```

### 2. Add to .env

```env
VITE_WS_URL=http://localhost:3002
```

### 3. Use the Hook in Your Component

```jsx
import { useNotifications } from '@/hooks/useNotifications';
import NotificationCenter from '@/components/NotificationCenter';

function App() {
    const user = useAuth(); // Get current user
    const workspace = useWorkspace(); // Get current workspace
    const token = getAuthToken(); // Get JWT token

    return (
        <div>
            {/* Add notification center to header */}
            <NotificationCenter
                userId={user.id}
                workspaceId={workspace.id}
                token={token}
            />
            
            {/* Rest of your app */}
        </div>
    );
}
```

### 4. Use the Hook Directly

```jsx
import { useNotifications } from '@/hooks/useNotifications';

function MyComponent() {
    const {
        notifications,      // Array of notifications
        unreadCount,        // Number of unread notifications
        isLoading,          // Loading state
        error,              // Any errors
        isConnected,        // WebSocket connection status
        refetch,            // Manual refetch function
        markAsRead,         // Mark single notification as read
        markAllAsRead,      // Mark all as read
        requestNotificationPermission
    } = useNotifications(userId, workspaceId, token);

    return (
        <div>
            <div>Unread: {unreadCount}</div>
            {isConnected ? <span>🟢 Connected</span> : <span>🔴 Disconnected</span>}
            
            {notifications.map(notif => (
                <div key={notif._id} onClick={() => markAsRead(notif._id)}>
                    {notif.message}
                </div>
            ))}
        </div>
    );
}
```

## Real-time Flow Example

### When a Board is Created:

1. **User A** creates a public board via REST API
   ```
   POST /v1/board { is_private: false, name: "My Board" }
   ```

2. **Backend** processes the creation:
   - Saves board to database
   - Creates notifications in `Notification` collection
   - Emits real-time events via WebSocket

3. **WebSocket Service** broadcasts:
   - Calculates recipients based on sharing settings
   - Sends notification to each recipient's room (`user:{userId}`)

4. **Frontend** receives:
   - Socket listener receives `notification` event
   - React Query cache is updated
   - UI updates immediately
   - Browser notification appears (if permitted)

## Notification Format

```javascript
{
    _id: "notification_id",
    workspace_id: "workspace_id",
    recipient_id: "user_id",
    actor_id: "user_id",
    action: "create",                    // create, update, delete, share, comment
    entity_type: "board",                // board, page, folder, space, etc.
    entity_id: "entity_id",
    entity_name: "Board Name",
    message: "Created a new board: Board Name",
    metadata: {
        actor_name: "John Doe",
        changes: ["name", "shared_members"],
        // ... other context
    },
    is_read: false,
    createdAt: "2026-04-25T10:30:00Z",
    updatedAt: "2026-04-25T10:30:00Z"
}
```

## WebSocket Events

### Client Events (Frontend sends)

- `ping` - Keep-alive signal

### Server Events (Backend sends)

- `connected` - Confirms connection
  ```javascript
  { socketId: "...", userId: "...", workspaceId: "..." }
  ```

- `notification` - Real-time notification
  ```javascript
  { type: "notification", data: {...}, timestamp: "..." }
  ```

- Custom events (extensible)
  ```javascript
  broadcastEvent(workspaceId, 'user:typing', { userId, pageId })
  ```

## Handling Connection Issues

The system includes automatic reconnection:

```javascript
// useRealtimeNotifications automatically:
// - Reconnects on disconnect
// - Handles connection errors
// - Falls back to polling via API
```

You can also manually check connection status:

```javascript
const { isConnected } = useNotifications(...);

if (!isConnected) {
    // Show warning to user
}
```

## Browser Notifications

The system supports native browser notifications:

```jsx
// Request permission
requestNotificationPermission();

// Notifications appear automatically when:
// - A notification is received
// - User has granted permission
// - Browser is in focus
```

## Performance Considerations

### Optimizations in Place

1. **Room-based Broadcasting**
   - Each user has their own room
   - Only targeted notifications sent
   - Reduces network overhead

2. **Connection Pooling**
   - Reuses single WebSocket per user
   - Handles multiple tabs gracefully

3. **Query Caching**
   - React Query caches notifications
   - Reduces API calls
   - Real-time updates via WebSocket

4. **Lazy Loading**
   - Socket.io client loaded on demand
   - Fallback to polling if unavailable

### Monitoring

To monitor WebSocket performance:

```javascript
const { isConnected } = useNotifications(...);

// Log to analytics
console.log({
    event: 'websocket_status',
    connected: isConnected,
    timestamp: new Date()
});
```

## Troubleshooting

### WebSocket Not Connecting

1. Check `WS_PORT` is open: `nc -zv localhost 3002`
2. Verify `FRONTEND_URL` in backend env
3. Check CORS settings in `websocketService.js`
4. Ensure JWT token is valid

### Notifications Not Appearing

1. Check console for errors
2. Verify notification recipients calculation
3. Check that `is_private` and `shared_members` are set correctly
4. Test via REST API first: `GET /v1/notification`

### High Latency

1. Check network connection
2. Verify server resources (CPU, memory)
3. Consider using Redis for scaling (future enhancement)

## Scaling Considerations (Future)

For multi-server deployment, consider:

1. **Redis Adapter** - Share socket state across servers
2. **Message Queue** - Buffer notifications during high load
3. **CDN** - For static assets
4. **Load Balancer** - Sticky sessions for WebSocket

Example Redis integration:
```javascript
import { createAdapter } from '@socket.io/redis-adapter';
import { createClient } from 'redis';

const pubClient = createClient();
const subClient = pubClient.duplicate();

io.adapter(createAdapter(pubClient, subClient));
```

## Testing

### Manual Testing

1. Open two browser tabs
2. Log in as different users
3. Create/update/delete entities in one tab
4. Verify notifications appear in other tab instantly

### Automated Testing

```javascript
// Test WebSocket connection
describe('WebSocket Notifications', () => {
    it('should receive notification when entity is created', async () => {
        const socket = io(WS_URL, { auth: { token, userId, workspaceId } });
        
        // Listen for notification
        const notificationPromise = new Promise(resolve => {
            socket.on('notification', resolve);
        });

        // Trigger creation via API
        await createEntity(...);

        // Assert notification received
        const notification = await notificationPromise;
        expect(notification.action).toBe('create');
    });
});
```

## API Reference

See `NOTIFICATION_SYSTEM.md` for REST API endpoints.
