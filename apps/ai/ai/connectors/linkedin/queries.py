"""LinkedIn web app's query IDs and real-time topics for messaging, copied from its own traffic (captured 29 October 2026).

These are LinkedIn's hashes of its GraphQL queries and change when it ships a new web build: a call that suddenly
answers 400 or 404 usually means one of them is stale, and the fix is a fresh capture, not a code change elsewhere.
Constants only; the calls that use them are in api.py and realtime.py."""

CLIENT_VERSION = "1.13.47368"  # voyager-web's, sent in x-li-track

CONVERSATIONS = "messengerConversations.0d5e6781bbee71c3e51c8843c6519f48"  # (mailboxUrn)
CONVERSATIONS_CHANGES = "messengerConversations.74c17e85611b60b7ba2700481151a316"  # (mailboxUrn, syncToken)
CONVERSATIONS_BEFORE = "messengerConversations.9501074288a12f3ae9e3c7ea243bccbf"  # (query, count, mailboxUrn, lastUpdatedBefore)
MESSAGES = "messengerMessages.5846eeb71c981f11e0134cb6626cc314"  # (conversationUrn)
MESSAGES_BEFORE = "messengerMessages.d8ea76885a52fd5dc5c317078ab7c977"  # (deliveredAt, conversationUrn, countBefore, countAfter)
TYPEAHEAD = "voyagerMessagingDashMessagingTypeahead.a7f105649500a01711c9d482ee4fad3d"  # (keyword, types)
TYPEAHEAD_TYPES = ("CONNECTIONS", "GROUP_THREADS", "PEOPLE", "COWORKERS")

# Sent with /realtime/connect so the stream decorates messaging events the way the web app asks for them.
REALTIME_QUERIES = {
    "conversationDeletesBroadcastTopic": "voyagerMessagingDashMessengerRealtimeDecoration.282abe5fa1a242cb76825c32dbbfaede",
    "conversationDeletesTopic": "voyagerMessagingDashMessengerRealtimeDecoration.282abe5fa1a242cb76825c32dbbfaede",
    "conversationDraftDeletesTopic": "voyagerMessagingDashMessengerRealtimeDecoration.5288036a2c0e63f49d34ee32b139976c",
    "conversationDraftsTopic": "voyagerMessagingDashMessengerRealtimeDecoration.a43ce157d7114b1a0f8da5e02a60ce38",
    "conversationsBroadcastTopic": "voyagerMessagingDashMessengerRealtimeDecoration.f855048b390b286e513d7b23c59efee3",
    "conversationsTopic": "voyagerMessagingDashMessengerRealtimeDecoration.f855048b390b286e513d7b23c59efee3",
    "messageDraftDeletesTopic": "voyagerMessagingDashMessengerRealtimeDecoration.e3e4c7121838321a42752b55f487a73e",
    "messageDraftsTopic": "voyagerMessagingDashMessengerRealtimeDecoration.fcf7b54d258c27799a693785bd4fcc11",
    "messageReactionSummariesBroadcastTopic": "voyagerMessagingDashMessengerRealtimeDecoration.85ff5a1aabf7c52f40aa85ccc84e3bf5",
    "messageReactionSummariesTopic": "voyagerMessagingDashMessengerRealtimeDecoration.85ff5a1aabf7c52f40aa85ccc84e3bf5",
    "messageSeenReceiptsBroadcastTopic": "voyagerMessagingDashMessengerRealtimeDecoration.e23d3971dc83a115b03584cf2381256c",
    "messageSeenReceiptsTopic": "voyagerMessagingDashMessengerRealtimeDecoration.e23d3971dc83a115b03584cf2381256c",
    "messagesBroadcastTopic": "voyagerMessagingDashMessengerRealtimeDecoration.db0f1d3f53747f49f3fd87b139df9eda",
    "messagesTopic": "voyagerMessagingDashMessengerRealtimeDecoration.db0f1d3f53747f49f3fd87b139df9eda",
    "messagingSecondaryPreviewBannerTopic": "voyagerMessagingDashRealtimeDecoration.7e837eb2d92f4f00045a0d0fa23bbdce",
    "replySuggestionBroadcastTopic": "voyagerMessagingDashMessengerRealtimeDecoration.412964c3f7f5a67fb0e56b6bb3a00028",
    "replySuggestionTopicV2": "voyagerMessagingDashMessengerRealtimeDecoration.412964c3f7f5a67fb0e56b6bb3a00028",
    "typingIndicatorsBroadcastTopic": "voyagerMessagingDashMessengerRealtimeDecoration.234ce03cd062b2438dae060ca854a6d2",
    "typingIndicatorsTopic": "voyagerMessagingDashMessengerRealtimeDecoration.234ce03cd062b2438dae060ca854a6d2",
}

REALTIME_RECIPES = {
    "inAppAlertsTopic": "com.linkedin.voyager.dash.deco.identity.notifications.InAppAlert-53",
    "professionalEventsTopic": "com.linkedin.voyager.dash.deco.events.ProfessionalEventDetailPage-65",
    "tabBadgeUpdateTopic": "com.linkedin.voyager.dash.deco.notifications.RealtimeBadgingItemCountsEvent-1",
    "topCardLiveVideoTopic": "com.linkedin.voyager.dash.deco.video.TopCardLiveVideo-11",
}
