#!/bin/bash
# Test runner script for pgTAP SQL tests

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Database connection parameters
DB_HOST="${DB_HOST:-localhost}"
DB_PORT="${DB_PORT:-54322}"
DB_NAME="${DB_NAME:-postgres}"
DB_USER="${DB_USER:-postgres}"
DB_PASSWORD="${DB_PASSWORD:-postgres}"

# Count test results
TOTAL_TESTS=0
PASSED_TESTS=0
FAILED_TESTS=0

echo "========================================"
echo "  Nimble PnL SQL Function Test Suite"
echo "========================================"
echo ""
echo "Database: $DB_NAME"
echo "Host: $DB_HOST:$DB_PORT"
echo ""

# Get the directory where this script is located
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
PROJECT_ROOT="$( cd "$SCRIPT_DIR/../.." && pwd )"

# Check if database is reachable
echo "Checking database connection..."
if ! PGPASSWORD=$DB_PASSWORD psql -h $DB_HOST -p $DB_PORT -U $DB_USER -d $DB_NAME -c "SELECT 1;" > /dev/null 2>&1; then
    echo -e "${RED}Error: Cannot connect to database at $DB_HOST:$DB_PORT${NC}"
    echo ""
    echo "Please ensure Supabase is running:"
    echo "  cd $PROJECT_ROOT && supabase start"
    echo ""
    echo "Or if using a different database, set environment variables:"
    echo "  DB_HOST=<host> DB_PORT=<port> DB_USER=<user> DB_PASSWORD=<password> ./run_tests.sh"
    exit 1
fi
echo -e "${GREEN}Database connection successful${NC}"

# Check if pgTAP extension exists
echo "Checking pgTAP extension..."
PGTAP_CHECK=$(PGPASSWORD=$DB_PASSWORD psql -h $DB_HOST -p $DB_PORT -U $DB_USER -d $DB_NAME -tAc "SELECT COUNT(*) FROM pg_extension WHERE extname='pgtap';" 2>/dev/null || echo "0")

if [ "$PGTAP_CHECK" = "0" ]; then
    echo -e "${YELLOW}Warning: pgTAP extension not found. Attempting to install...${NC}"
    
    # Try to create the extension directly
    if PGPASSWORD=$DB_PASSWORD psql -h $DB_HOST -p $DB_PORT -U $DB_USER -d $DB_NAME -c "CREATE EXTENSION IF NOT EXISTS pgtap;" 2>/dev/null; then
        echo -e "${GREEN}pgTAP extension installed successfully${NC}"
    else
        echo -e "${RED}Error: Could not install pgTAP extension${NC}"
        echo ""
        echo "This usually means migrations haven't been applied."
        echo "Please run:"
        echo "  cd $PROJECT_ROOT && supabase db reset"
        echo ""
        echo "Or apply the migration manually:"
        echo "  PGPASSWORD=$DB_PASSWORD psql -h $DB_HOST -p $DB_PORT -U $DB_USER -d $DB_NAME -f $PROJECT_ROOT/supabase/migrations/20251010223450_enable_pgtap.sql"
        exit 1
    fi
else
    echo -e "${GREEN}pgTAP extension found${NC}"
fi

echo ""
echo "Running tests..."
echo "----------------------------------------"

# Run each test file
for test_file in "$SCRIPT_DIR"/*.sql; do
    # Skip if it's the README or run_tests files
    if [[ "$test_file" == *"README"* ]] || [[ "$test_file" == *"run_tests"* ]]; then
        continue
    fi
    
    filename=$(basename "$test_file")
    echo ""
    echo "Running: $filename"
    
    # Run the test and capture output
    output=$(PGPASSWORD=$DB_PASSWORD psql -h $DB_HOST -p $DB_PORT -U $DB_USER -d $DB_NAME -v ON_ERROR_STOP=1 -f "$test_file" 2>&1)
    exit_code=$?
    
    # Always show output for debugging in CI
    echo "--- Test Output ---"
    echo "$output"
    echo "--- End Output ---"
    
    # Check for SQL errors and fail fast
    if [ $exit_code -ne 0 ]; then
        echo -e "${RED}✗ SQL error in $filename (exit code: $exit_code)${NC}"
        exit $exit_code
    fi
    
    # Parse test results
    if echo "$output" | grep -q "All .* tests passed"; then
        test_count=$(echo "$output" | grep -oP '\d+(?= tests? passed)' | tail -1)
        TOTAL_TESTS=$((TOTAL_TESTS + test_count))
        PASSED_TESTS=$((PASSED_TESTS + test_count))
        echo -e "${GREEN}✓ $test_count tests passed${NC}"
    else
        # Count individual test results
        passed=$(echo "$output" | grep -oP '(?<=ok )\d+' | wc -l)
        failed=$(echo "$output" | grep -oP '(?<=not ok )\d+' | wc -l)
        TOTAL_TESTS=$((TOTAL_TESTS + passed + failed))
        PASSED_TESTS=$((PASSED_TESTS + passed))
        FAILED_TESTS=$((FAILED_TESTS + failed))
        
        if [ $failed -gt 0 ]; then
            echo -e "${RED}✗ $failed tests failed, $passed passed${NC}"
            echo "$output" | grep "not ok"
        else
            echo -e "${GREEN}✓ $passed tests passed${NC}"
        fi
    fi
done

echo ""
echo "========================================"
echo "  Test Summary"
echo "========================================"
echo "Total tests:  $TOTAL_TESTS"
echo -e "${GREEN}Passed:       $PASSED_TESTS${NC}"
if [ $FAILED_TESTS -gt 0 ]; then
    echo -e "${RED}Failed:       $FAILED_TESTS${NC}"
else
    echo -e "${GREEN}Failed:       $FAILED_TESTS${NC}"
fi
echo ""

if [ $FAILED_TESTS -eq 0 ]; then
    echo -e "${GREEN}All tests passed! 🎉${NC}"
    exit 0
else
    echo -e "${RED}Some tests failed 😞${NC}"
    exit 1
fi
