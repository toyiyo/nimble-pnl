#!/bin/bash

# Test Stripe Subscription Webhooks
# Usage: ./test-webhook.sh <scenario_number>
#
# Scenarios:
#   1  - New subscription (checkout completed)
#   2  - Subscription created
#   3  - Upgrade: Starter -> Growth
#   4  - Upgrade: Growth -> Pro
#   5  - Downgrade: Pro -> Starter
#   6  - Cancel scheduled (end of period)
#   7  - Reactivate before cancel completes
#   8  - Subscription deleted (fully canceled)
#   9  - Resubscribe after cancellation
#   10 - Payment failed
#   11 - Payment succeeded after failure
#   12 - Annual subscription

WEBHOOK_URL="${WEBHOOK_URL:-http://localhost:54321/functions/v1/stripe-subscription-webhook}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SCENARIOS_FILE="$SCRIPT_DIR/test-scenarios.json"

# Check if jq is installed
if ! command -v jq &> /dev/null; then
    echo "Error: jq is required but not installed. Install with: brew install jq"
    exit 1
fi

# Function to send webhook
send_webhook() {
    local scenario_key=$1
    local scenario_name=$2

    echo "=================================================="
    echo "Testing: $scenario_name"
    echo "=================================================="

    # Extract the scenario and send it
    local payload=$(jq -c ".scenarios[\"$scenario_key\"]" "$SCENARIOS_FILE")

    if [ "$payload" == "null" ]; then
        echo "Error: Scenario '$scenario_key' not found"
        exit 1
    fi

    echo "Sending to: $WEBHOOK_URL"
    echo ""

    response=$(curl -s -X POST "$WEBHOOK_URL" \
        -H "stripe-signature: test_local" \
        -H "Content-Type: application/json" \
        -d "$payload")

    echo "Response: $response"
    echo ""
}

# Show usage
show_usage() {
    echo "Stripe Subscription Webhook Tester"
    echo ""
    echo "Usage: $0 <scenario_number|all>"
    echo ""
    echo "Scenarios:"
    echo "  1  - New subscription (checkout completed)"
    echo "  2  - Subscription created"
    echo "  3  - Upgrade: Starter -> Growth"
    echo "  4  - Upgrade: Growth -> Pro"
    echo "  5  - Downgrade: Pro -> Starter"
    echo "  6  - Cancel scheduled (end of period)"
    echo "  7  - Reactivate before cancel completes"
    echo "  8  - Subscription deleted (fully canceled)"
    echo "  9  - Resubscribe after cancellation"
    echo "  10 - Payment failed"
    echo "  11 - Payment succeeded after failure"
    echo "  12 - Annual subscription"
    echo "  all - Run all scenarios in sequence"
    echo ""
    echo "Environment variables:"
    echo "  WEBHOOK_URL - Override webhook URL (default: http://localhost:54321/functions/v1/stripe-subscription-webhook)"
    echo ""
    echo "Examples:"
    echo "  $0 1              # Test new subscription"
    echo "  $0 3              # Test upgrade to Growth"
    echo "  $0 all            # Run all scenarios"
}

# Map scenario number to key and name
get_scenario() {
    case $1 in
        1) echo "1_new_subscription_checkout_completed|New Subscription (Checkout)" ;;
        2) echo "2_new_subscription_created|Subscription Created" ;;
        3) echo "3_upgrade_starter_to_growth|Upgrade: Starter -> Growth" ;;
        4) echo "4_upgrade_growth_to_pro|Upgrade: Growth -> Pro" ;;
        5) echo "5_downgrade_pro_to_starter|Downgrade: Pro -> Starter" ;;
        6) echo "6_cancel_scheduled|Cancel Scheduled (End of Period)" ;;
        7) echo "7_reactivate_before_cancel_completes|Reactivate Before Cancel" ;;
        8) echo "8_subscription_deleted|Subscription Deleted" ;;
        9) echo "9_resubscribe_after_cancellation|Resubscribe After Cancellation" ;;
        10) echo "10_payment_failed|Payment Failed" ;;
        11) echo "11_payment_succeeded_after_failure|Payment Succeeded After Failure" ;;
        12) echo "12_annual_subscription|Annual Subscription" ;;
        *) echo "" ;;
    esac
}

# Main logic
if [ -z "$1" ]; then
    show_usage
    exit 0
fi

if [ "$1" == "all" ]; then
    echo "Running all scenarios..."
    echo ""
    for i in {1..12}; do
        scenario_info=$(get_scenario $i)
        scenario_key=$(echo "$scenario_info" | cut -d'|' -f1)
        scenario_name=$(echo "$scenario_info" | cut -d'|' -f2)
        send_webhook "$scenario_key" "$scenario_name"
        echo ""
        sleep 1  # Small delay between scenarios
    done
    echo "All scenarios completed!"
else
    scenario_info=$(get_scenario $1)
    if [ -z "$scenario_info" ]; then
        echo "Error: Invalid scenario number '$1'"
        echo ""
        show_usage
        exit 1
    fi

    scenario_key=$(echo "$scenario_info" | cut -d'|' -f1)
    scenario_name=$(echo "$scenario_info" | cut -d'|' -f2)
    send_webhook "$scenario_key" "$scenario_name"
fi
