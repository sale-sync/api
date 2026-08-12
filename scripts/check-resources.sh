#!/usr/bin/env bash
# Lists CloudFormation stacks, DynamoDB tables, S3 buckets, and Lambda
# functions for the staging or production Sale Sync stack. Read-only —
# useful for spotting orphaned resources (DeletionPolicy: Retain survives
# stack rollback) or name collisions before/after a deploy.
#
# Usage:
#   source scripts/check-resources.sh && check_sale_sync_resources staging
#   ./scripts/check-resources.sh prod [region]
#   ./scripts/check-resources.sh both [region]
#   ./scripts/check-resources.sh admin staging [region]   # admin API stack instead
#   ./scripts/check-resources.sh admin prod [region]
#   ./scripts/check-resources.sh admin both [region]
#   ./scripts/check-resources.sh queries staging [region] # queries API stack instead
#   ./scripts/check-resources.sh queries prod [region]
#   ./scripts/check-resources.sh queries both [region]

_check_one() {
    local prefix="$1" stack_name="$2" region="$3"

    echo "=== [$stack_name] CloudFormation stacks (${stack_name}*) — region ${region} ==="
    aws cloudformation list-stacks \
        --region "$region" \
        --stack-status-filter CREATE_COMPLETE CREATE_FAILED ROLLBACK_COMPLETE ROLLBACK_FAILED \
            UPDATE_COMPLETE UPDATE_ROLLBACK_COMPLETE UPDATE_ROLLBACK_FAILED DELETE_FAILED \
        --query "StackSummaries[?starts_with(StackName, '${stack_name}')].[StackName,StackStatus,CreationTime]" \
        --output table

    echo
    echo "=== [$stack_name] DynamoDB tables (${prefix}*) ==="
    aws dynamodb list-tables \
        --region "$region" \
        --query "TableNames[?starts_with(@, '${prefix}')]" \
        --output table

    echo
    echo "=== [$stack_name] S3 buckets (${prefix}*) ==="
    aws s3api list-buckets \
        --query "Buckets[?starts_with(Name, '${prefix}')].Name" \
        --output table

    echo
    echo "=== [$stack_name] Lambda functions (${stack_name}-* or ${prefix}*) — region ${region} ==="
    aws lambda list-functions \
        --region "$region" \
        --query "Functions[?starts_with(FunctionName, '${stack_name}') || starts_with(FunctionName, '${prefix}')].[FunctionName,Runtime,LastModified]" \
        --output table
    echo
}

check_sale_sync_resources() {
    local env="$1"
    local region="${2:-ap-southeast-2}"

    case "$env" in
        staging)
            _check_one "staging-sale-sync-" "staging-sale-sync-api" "$region"
            ;;
        prod|production)
            _check_one "sale-sync-" "sale-sync-api" "$region"
            ;;
        both)
            _check_one "staging-sale-sync-" "staging-sale-sync-api" "$region"
            _check_one "sale-sync-" "sale-sync-api" "$region"
            ;;
        *)
            echo "Usage: check_sale_sync_resources <staging|prod|both> [region]" >&2
            return 1
            ;;
    esac
}

# Admin API stack (sale-sync-admin-api / staging-sale-sync-admin-api) — shares the same
# OrganisationTable/prefix as the client API (no own DynamoDB/S3), so those two sections will
# just re-show the client API's resources; the CloudFormation/Lambda sections are the useful
# ones here (they filter on the admin stack name instead).
check_sale_sync_admin_resources() {
    local env="$1"
    local region="${2:-ap-southeast-2}"

    case "$env" in
        staging)
            _check_one "staging-sale-sync-" "staging-sale-sync-admin-api" "$region"
            ;;
        prod|production)
            _check_one "sale-sync-" "sale-sync-admin-api" "$region"
            ;;
        both)
            _check_one "staging-sale-sync-" "staging-sale-sync-admin-api" "$region"
            _check_one "sale-sync-" "sale-sync-admin-api" "$region"
            ;;
        *)
            echo "Usage: check_sale_sync_admin_resources <staging|prod|both> [region]" >&2
            return 1
            ;;
    esac
}

# Queries API stack (sale-sync-queries-api / staging-sale-sync-queries-api) — shares the same
# OrganisationTable/PropertyTable/prefix as the client API (no own DynamoDB/S3), so those two
# sections will just re-show the client API's resources; the CloudFormation/Lambda sections are
# the useful ones here (they filter on the queries stack name instead).
check_sale_sync_queries_resources() {
    local env="$1"
    local region="${2:-ap-southeast-2}"

    case "$env" in
        staging)
            _check_one "staging-sale-sync-" "staging-sale-sync-queries-api" "$region"
            ;;
        prod|production)
            _check_one "sale-sync-" "sale-sync-queries-api" "$region"
            ;;
        both)
            _check_one "staging-sale-sync-" "staging-sale-sync-queries-api" "$region"
            _check_one "sale-sync-" "sale-sync-queries-api" "$region"
            ;;
        *)
            echo "Usage: check_sale_sync_queries_resources <staging|prod|both> [region]" >&2
            return 1
            ;;
    esac
}

# Allow running directly (./scripts/check-resources.sh staging) as well as sourcing.
if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
    if [[ "$1" == "admin" ]]; then
        shift
        check_sale_sync_admin_resources "$@"
    elif [[ "$1" == "queries" ]]; then
        shift
        check_sale_sync_queries_resources "$@"
    else
        check_sale_sync_resources "$@"
    fi
fi
