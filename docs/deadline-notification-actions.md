# Deadline Status Confirmation UI — Implementation Notes

## Overview

Implemented quick action buttons for overdue deadline notifications that allow users to confirm completion status directly from push notifications on their iPhone, without opening the app.

## Changes Made

### 1. Service Worker (`apps/web/public/sw.js`)

**Push Event Handler (lines 1-48)**
- Extended payload parsing to include `deadlineId` and `source` fields
- Added action buttons to notifications when:
  - `deadlineId` is present 
  - `source` is `"assignment-tracker"`
- Actions: "Mark complete" and "Still working"

**New Event Handler: `notificationactionclick` (lines 73-116)**
- Closes the notification
- Extracts `deadlineId` from notification data
- Maps action to completion status:
  - `action === "complete"` → `completed: true`
  - `action === "working"` → `completed: false`
- Calls `POST /companion/api/deadlines/{id}/confirm-status` with JSON body
- Shows success/failure confirmation notification

### 2. Backend Types (`apps/server/src/types.ts`)

**Notification Interface (lines 18-26)**
- Added optional `metadata?: Record<string, unknown>` field
- Allows passing arbitrary data with notifications (e.g., deadline IDs)

### 3. Orchestrator (`apps/server/src/orchestrator.ts`)

**`emitOverdueDeadlineReminders()` Method (lines 139-147)**
- Added `metadata: { deadlineId: deadline.id }` to notification payload
- Enables service worker to identify which deadline to update

### 4. Push Service (`apps/server/src/push.ts`)

**`sendPushNotification()` Function (lines 44-56)**
- Updated type signature to include `"metadata"` in notification pick
- Extracts `deadlineId` from `notification.metadata?.deadlineId`
- Includes it in the JSON payload sent to the service worker

## User Flow

1. **Deadline becomes overdue** → Orchestrator detects it
2. **Push notification sent** with action buttons
3. **User clicks "Mark complete" or "Still working"** on notification
4. **Service worker** calls `/api/deadlines/{id}/confirm-status`
5. **Server updates** deadline reminder state
6. **Confirmation notification** shows result

## Testing

- All 148 backend tests pass ✅
- Web app builds successfully ✅
- No breaking changes to existing functionality

## Notes

- Action buttons only appear on **overdue deadline notifications** from `assignment-tracker`
- Other notifications (journal prompts, lecture reminders, etc.) remain unchanged
- API endpoint `/api/deadlines/:id/confirm-status` already existed — no backend changes needed there
- Matches existing button behavior in `DeadlineList.tsx` component
