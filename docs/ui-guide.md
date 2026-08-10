# UI Guide

## Question Inbox

The question inbox lives at `/questions`. It loads open parked questions from
`GET /api/questions` and displays each question's agent, context, and text in a
table. Each row has its own answer textarea and submit button; a successful
`POST /api/questions/:id/answer` removes that question from the visible list.

The view shows `Loading questions...` while the request is pending,
`Unable to load questions` when the API is unavailable, and `No parked questions`
when the API returns an empty list.
