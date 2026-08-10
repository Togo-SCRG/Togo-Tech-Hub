"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { FolderKanban, Zap } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { ProjectsView } from "@/components/projects/ProjectsView";
import { CreateProjectModal } from "@/components/projects/CreateProjectModal";
import { CreateTaskModal } from "@/components/tasks/CreateTaskModal";
import { TasksView, type TaskRow } from "@/components/tasks/TasksView";
import { useCurrentUser } from "@/lib/useCurrentUser";
import { can } from "@/lib/capabilities";
import { cn, toDateInputValue } from "@/lib/utils";
import type { MemberItem } from "@/types";

type Tab = "projects" | "tasks";

/**
 * Projects and tasks under one page, as two tabs.
 *
 * The create button lives here rather than inside either view, because it's one
 * button whose meaning follows the tab: "New project" on one, "New task" on the
 * other. Two buttons in two toolbars would have meant one of them was always
 * pointing at the list you weren't looking at.
 */
export function ProjectsTabs({
  projects,
  members,
  tasks,
}: {
  projects: React.ComponentProps<typeof ProjectsView>["projects"];
  members: React.ComponentProps<typeof ProjectsView>["members"];
  tasks: TaskRow[];
}) {
  const router = useRouter();
  const { currentUser } = useCurrentUser();
  const [tab, setTab] = useState<Tab>("projects");
  const [createProjectOpen, setCreateProjectOpen] = useState(false);
  const [newTaskOpen, setNewTaskOpen] = useState(false);
  const [fullMembers, setFullMembers] = useState<MemberItem[]>([]);

  // Both modals need the full member records, not the {id,name} pairs the
  // projects table filters by.
  useEffect(() => {
    fetch("/api/members")
      .then((res) => res.json())
      .then((data) => setFullMembers(data.members || []))
      .catch(() => {});
  }, []);

  // One permission for both: starting a piece of work shouldn't need a different
  // capability depending on which kind it is. The RLS policy on `tasks`
  // (migration 041) enforces the same rule.
  const canCreate = can(currentUser?.capabilities, "project.create");
  const canDeleteTask = can(currentUser?.capabilities, "project.delete");

  const TABS: { key: Tab; label: string; icon: typeof FolderKanban; count: number }[] = [
    { key: "projects", label: "Projects", icon: FolderKanban, count: projects.length },
    { key: "tasks", label: "Tasks", icon: Zap, count: tasks.length },
  ];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-2 border-b border-togo-border">
        <div role="tablist" aria-label="Projects and tasks" className="flex gap-1">
          {TABS.map((t) => {
            const Icon = t.icon;
            const active = tab === t.key;
            return (
              <button
                key={t.key}
                role="tab"
                aria-selected={active}
                onClick={() => setTab(t.key)}
                className={cn(
                  "-mb-px flex items-center gap-1.5 border-b-2 px-3 py-2 text-sm font-semibold transition-colors",
                  active
                    ? "border-togo-blue text-togo-blue"
                    : "border-transparent text-togo-muted hover:text-togo-white"
                )}
              >
                <Icon size={14} className="shrink-0" />
                {t.label}
                <span
                  className={cn(
                    "tnum rounded px-1.5 py-0.5 text-[10px] font-bold leading-none",
                    active ? "bg-togo-blue/15 text-togo-blue" : "bg-togo-surface-2 text-togo-muted"
                  )}
                >
                  {t.count}
                </span>
              </button>
            );
          })}
        </div>

        {/* mb-1.5 so the button clears the tab underline rather than colliding
            with it — same treatment as the notifications page. */}
        <div className="mb-1.5">
          {canCreate && (
            <Button
              size="sm"
              onClick={() => (tab === "projects" ? setCreateProjectOpen(true) : setNewTaskOpen(true))}
            >
              + New {tab === "projects" ? "project" : "task"}
            </Button>
          )}
        </div>
      </div>

      {tab === "projects" ? (
        <ProjectsView
          projects={projects}
          members={members}
          onCreateProject={() => setCreateProjectOpen(true)}
        />
      ) : (
        <TasksView
          tasks={tasks}
          onCreateTask={canCreate ? () => setNewTaskOpen(true) : undefined}
          canDelete={canDeleteTask}
        />
      )}

      {canCreate && (
        <>
          <CreateProjectModal
            open={createProjectOpen}
            onClose={() => setCreateProjectOpen(false)}
            members={fullMembers}
          />
          <CreateTaskModal open={newTaskOpen} onClose={() => setNewTaskOpen(false)} />
        </>
      )}
    </div>
  );
}
