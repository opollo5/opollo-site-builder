"use client";

import * as React from "react";
import Link from "next/link";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { SocialPostDetailClient } from "@/components/SocialPostDetailClient";
import { TDetailTabbed } from "@/templates";
import type { TabItem } from "@/templates";
import type { PostMaster } from "@/lib/platform/social/posts";

// ---------------------------------------------------------------------------
// PostDetailTabbedClient — client wrapper for /company/social/posts/[id].
//
// Manages tab state locally. All server-fetched sections are passed as
// ReactNode props from the server page so the server handles data loading.
//
// Tab presence is conditional:
//   content       — always (post body + variants)
//   approval      — only pending_client_approval
//   review        — only approved/rejected/changes_requested
//   schedule      — only approved or scheduled
//   history       — only publishing/published/failed
//
// footerActions: "Back to posts" always + "Schedule another" when published
// (D-4 fix for RECURRING-2 — post-publish dead-end).
// ---------------------------------------------------------------------------

interface PostDetailTabbedClientProps {
  post: PostMaster;
  canEdit: boolean;
  canSubmit: boolean;
  canCreate: boolean;
  canApprove: boolean;
  variantsSection: React.ReactNode | null;
  approvalSection: React.ReactNode | null;
  decisionsSection: React.ReactNode | null;
  scheduleSection: React.ReactNode | null;
  publishHistorySection: React.ReactNode | null;
}

export function PostDetailTabbedClient({
  post,
  canEdit,
  canSubmit,
  canCreate,
  canApprove,
  variantsSection,
  approvalSection,
  decisionsSection,
  scheduleSection,
  publishHistorySection,
}: PostDetailTabbedClientProps) {
  const [activeTab, setActiveTab] = useState("content");

  const postLabel = post.master_text
    ? post.master_text.slice(0, 60) + (post.master_text.length > 60 ? "…" : "")
    : "Post detail";

  const contentTabContent = (
    <>
      <SocialPostDetailClient
        post={post}
        canEdit={canEdit}
        canSubmit={canSubmit}
        canCreate={canCreate}
        canApprove={canApprove}
      />
      {variantsSection}
    </>
  );

  const tabs: TabItem[] = [
    { key: "content", label: "Content", content: contentTabContent },
    ...(approvalSection
      ? [{ key: "approval", label: "Approval", content: approvalSection }]
      : []),
    ...(decisionsSection
      ? [{ key: "review", label: "Review", content: decisionsSection }]
      : []),
    ...(scheduleSection
      ? [{ key: "schedule", label: "Schedule", content: scheduleSection }]
      : []),
    ...(publishHistorySection
      ? [{ key: "history", label: "Publish history", content: publishHistorySection }]
      : []),
  ];

  const footerActions = (
    <>
      <Button asChild variant="outline">
        <Link href="/company/social/posts">← Back to posts</Link>
      </Button>
      {post.state === "published" && (
        <Button asChild data-testid="schedule-another-button">
          <Link href="/company/social/posts?compose=new">Schedule another</Link>
        </Button>
      )}
    </>
  );

  return (
    <TDetailTabbed
      title="Post detail"
      breadcrumb={[
        { label: "Social", href: "/company/social" },
        { label: "Posts", href: "/company/social/posts" },
        { label: postLabel },
      ]}
      tabs={tabs}
      activeTab={activeTab}
      onTabChange={setActiveTab}
      footerActions={footerActions}
    />
  );
}
