import { useTRPC, type Outputs } from "@repo/trpc/client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  Ban,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  CircleSlash,
  LogOut,
  Moon,
  PanelLeftClose,
  PanelLeftOpen,
  Plus,
  RefreshCw,
  Search,
  ShieldCheck,
  Sun,
  Trash2,
  UserCog,
  Users,
  X,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { authClient } from "../lib/auth";

export const Route = createFileRoute("/")({
  component: AdminRoute,
});

type AdminUser = Outputs["admin"]["listUsers"]["users"][number];
type AccountStatusFilter = "" | "active" | "banned";
type SubscriptionStatusFilter = "" | "pro" | "free";
type RoleFilter = "" | "admin" | "user";
type SortBy =
  | "createdAt"
  | "updatedAt"
  | "name"
  | "username"
  | "email"
  | "role"
  | "subscription"
  | "status";
type SortDirection = "asc" | "desc";
type ResolvedTheme = "light" | "dark";
type ThemeMode = ResolvedTheme | "system";
type DrawerMutation<TInput> = {
  error: unknown;
  isPending: boolean;
  mutate: (input: TInput) => void;
};

type DrawerMutations = {
  setRole: DrawerMutation<{ userId: string; role: "admin" | "user" }>;
  setSubscriptionOverride: DrawerMutation<{
    userId: string;
    status: "pro" | "free";
    reason: string;
  }>;
  clearSubscriptionOverride: DrawerMutation<{ userId: string; reason: string }>;
  banUser: DrawerMutation<{
    userId: string;
    reason: string;
    banExpiresIn?: number;
  }>;
  unbanUser: DrawerMutation<{ userId: string }>;
  deleteUser: DrawerMutation<{ userId: string; confirmationEmail: string }>;
};

const STATUS_FILTER_OPTIONS: { label: string; value: AccountStatusFilter }[] = [
  { label: "All", value: "" },
  { label: "Active", value: "active" },
  { label: "Banned", value: "banned" },
];

const SUBSCRIPTION_FILTER_OPTIONS: {
  label: string;
  value: SubscriptionStatusFilter;
}[] = [
  { label: "All", value: "" },
  { label: "Pro", value: "pro" },
  { label: "Free", value: "free" },
];

const ROLE_FILTER_OPTIONS: { label: string; value: RoleFilter }[] = [
  { label: "All", value: "" },
  { label: "User", value: "user" },
  { label: "Admin", value: "admin" },
];
const THEME_STORAGE_KEY = "cookclub-admin-theme";
const USER_TABLE_COLUMN_COUNT = 8;

function AdminRoute() {
  const session = authClient.useSession();
  const { resolvedTheme, toggleTheme } = useAdminTheme();

  if (session.isPending) {
    return (
      <main className="center-shell">
        <div className="loading-mark" />
      </main>
    );
  }

  if (!session.data) {
    return (
      <SignInScreen
        onSignedIn={() => {
          session.refetch().catch((error) => console.error(error));
        }}
        onToggleTheme={toggleTheme}
        theme={resolvedTheme}
      />
    );
  }

  return (
    <AdminDashboard
      currentUserEmail={session.data.user.email}
      onSignOut={async () => {
        await authClient.signOut();
        await session.refetch();
      }}
      onToggleTheme={toggleTheme}
      theme={resolvedTheme}
    />
  );
}

function useAdminTheme() {
  const [themeMode, setThemeMode] = useState<ThemeMode>(getStoredThemeMode);
  const [resolvedTheme, setResolvedTheme] = useState<ResolvedTheme>(() =>
    resolveThemeMode(getStoredThemeMode()),
  );

  useEffect(() => {
    const nextTheme = resolveThemeMode(themeMode);
    setResolvedTheme(nextTheme);

    if (themeMode !== "system") return undefined;

    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const handleSystemThemeChange = () => {
      setResolvedTheme(resolveThemeMode("system"));
    };

    media.addEventListener("change", handleSystemThemeChange);
    return () => {
      media.removeEventListener("change", handleSystemThemeChange);
    };
  }, [themeMode]);

  useEffect(() => {
    const root = document.documentElement;
    root.dataset.theme = resolvedTheme;
    root.style.colorScheme = resolvedTheme;
  }, [resolvedTheme]);

  return {
    resolvedTheme,
    toggleTheme: () => {
      const nextTheme = resolvedTheme === "dark" ? "light" : "dark";

      try {
        window.localStorage.setItem(THEME_STORAGE_KEY, nextTheme);
      } catch (error) {
        console.error(error);
      }

      setThemeMode(nextTheme);
      setResolvedTheme(nextTheme);
    },
  };
}

function SignInScreen({
  onSignedIn,
  onToggleTheme,
  theme,
}: {
  onSignedIn: () => void;
  onToggleTheme: () => void;
  theme: ResolvedTheme;
}) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submittingAction, setSubmittingAction] = useState<
    "email" | "google" | null
  >(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const oauthError = params.get("error");
    if (!oauthError) return;

    setError(getOAuthErrorMessage(oauthError, params.get("error_description")));

    params.delete("error");
    params.delete("error_description");
    const nextSearch = params.toString();
    const nextUrl = `${window.location.pathname}${nextSearch ? `?${nextSearch}` : ""}${window.location.hash}`;
    window.history.replaceState(null, "", nextUrl);
  }, []);

  const isEmailSubmitting = submittingAction === "email";
  const isGoogleSubmitting = submittingAction === "google";

  return (
    <main className="signin-shell">
      <section className="signin-panel" aria-label="Admin sign in">
        <div className="signin-panel-head">
          <div className="signin-brand">
            <img alt="" className="signin-mark" src="/icons/icon.png" />
            <div>
              <p className="eyebrow">Cook Club</p>
              <h1>Admin</h1>
            </div>
          </div>
          <ThemeToggle onToggleTheme={onToggleTheme} theme={theme} />
        </div>
        <form
          className="form-stack"
          onSubmit={async (event) => {
            event.preventDefault();
            setError(null);
            setSubmittingAction("email");

            try {
              const result = await authClient.signIn.email({
                email,
                password,
              });

              if (result.error) {
                setError(result.error.message ?? "Sign in failed.");
                return;
              }

              onSignedIn();
            } catch (cause) {
              setError(getErrorMessage(cause));
            } finally {
              setSubmittingAction(null);
            }
          }}
        >
          <label>
            <span>Email</span>
            <input
              autoComplete="email"
              inputMode="email"
              onChange={(event) => setEmail(event.target.value)}
              required
              type="email"
              value={email}
            />
          </label>
          <label>
            <span>Password</span>
            <input
              autoComplete="current-password"
              onChange={(event) => setPassword(event.target.value)}
              required
              type="password"
              value={password}
            />
          </label>
          {error ? <p className="form-error">{error}</p> : null}
          <button
            className="primary-button"
            disabled={Boolean(submittingAction)}
            type="submit"
          >
            <ShieldCheck size={18} />
            {isEmailSubmitting ? "Signing in" : "Sign in"}
          </button>
        </form>
        <div className="signin-divider" aria-hidden="true">
          <span>or</span>
        </div>
        <button
          className="secondary-button google-signin-button"
          disabled={Boolean(submittingAction)}
          onClick={async () => {
            setError(null);
            setSubmittingAction("google");

            try {
              const callbackURL = getAdminCallbackUrl();
              const result = await authClient.signIn.social({
                provider: "google",
                callbackURL,
                errorCallbackURL: callbackURL,
                disableRedirect: true,
              });

              if (result.error) {
                setError(result.error.message ?? "Google sign in failed.");
                setSubmittingAction(null);
                return;
              }

              if (result.data?.url) {
                window.location.assign(result.data.url);
                return;
              }

              setError("Google sign in did not return a redirect URL.");
            } catch (cause) {
              setError(getErrorMessage(cause));
            }

            setSubmittingAction(null);
          }}
          type="button"
        >
          <GoogleLogo />
          {isGoogleSubmitting ? "Opening Google" : "Sign in with Google"}
        </button>
      </section>
    </main>
  );
}

function GoogleLogo() {
  return (
    <svg
      aria-hidden="true"
      className="google-logo"
      focusable="false"
      viewBox="0 0 40 40"
    >
      <path
        clipRule="evenodd"
        d="M39.2 20.455c0-1.419-.127-2.782-.364-4.091H20V24.1h10.764c-.464 2.5-1.873 4.618-3.991 6.036v5.019h6.463c3.782-3.482 5.964-8.61 5.964-14.7Z"
        fill="#4285F4"
        fillRule="evenodd"
      />
      <path
        clipRule="evenodd"
        d="M20 40c5.4 0 9.927-1.791 13.236-4.846l-6.463-5.018c-1.791 1.2-4.082 1.91-6.773 1.91-5.21 0-9.618-3.519-11.191-8.246H2.127v5.181C5.418 35.519 12.182 40 20 40Z"
        fill="#34A853"
        fillRule="evenodd"
      />
      <path
        clipRule="evenodd"
        d="M8.81 23.8c-.4-1.2-.628-2.482-.628-3.8 0-1.318.227-2.6.627-3.8v-5.182H2.127A19.992 19.992 0 0 0 0 20c0 3.227.773 6.282 2.127 8.982L8.81 23.8Z"
        fill="#FBBC05"
        fillRule="evenodd"
      />
      <path
        clipRule="evenodd"
        d="M20 7.955c2.936 0 5.573 1.009 7.645 2.99l5.737-5.736C29.918 1.982 25.39 0 20 0 12.182 0 5.418 4.482 2.127 11.018L8.81 16.2c1.573-4.727 5.982-8.245 11.19-8.245Z"
        fill="#EA4335"
        fillRule="evenodd"
      />
    </svg>
  );
}

function AdminDashboard({
  currentUserEmail,
  onSignOut,
  onToggleTheme,
  theme,
}: {
  currentUserEmail: string;
  onSignOut: () => Promise<void>;
  onToggleTheme: () => void;
  theme: ResolvedTheme;
}) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<AccountStatusFilter>("");
  const [subscriptionStatus, setSubscriptionStatus] =
    useState<SubscriptionStatusFilter>("");
  const [role, setRole] = useState<RoleFilter>("");
  const [sortBy, setSortBy] = useState<SortBy>("createdAt");
  const [sortDirection, setSortDirection] = useState<SortDirection>("desc");
  const [offset, setOffset] = useState(0);
  const [selectedUser, setSelectedUser] = useState<AdminUser | null>(null);
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  const limit = 25;

  useEffect(() => {
    if (window.matchMedia("(max-width: 920px)").matches) {
      setIsSidebarOpen(false);
    }
  }, []);

  const queryInput = useMemo(
    () => ({
      search: search.trim() || undefined,
      status: status || undefined,
      subscriptionStatus: subscriptionStatus || undefined,
      role: role || undefined,
      limit,
      offset,
      sortBy,
      sortDirection,
    }),
    [offset, role, search, sortBy, sortDirection, status, subscriptionStatus],
  );

  const usersQuery = useQuery({
    ...trpc.admin.listUsers.queryOptions(queryInput),
    placeholderData: (previous) => previous,
  });

  const users = usersQuery.data?.users ?? [];
  const total = usersQuery.data?.total ?? 0;

  useEffect(() => {
    if (!selectedUser || !usersQuery.data) return;

    const nextSelectedUser = users.find((user) => user.id === selectedUser.id);
    if (nextSelectedUser) {
      if (nextSelectedUser !== selectedUser) setSelectedUser(nextSelectedUser);
      return;
    }

    setSelectedUser(null);
  }, [selectedUser, users, usersQuery.data]);

  const invalidateUsers = async () => {
    await queryClient.invalidateQueries(trpc.admin.listUsers.pathFilter());
  };

  const createUserMutation = useMutation({
    ...trpc.admin.createUser.mutationOptions(),
    onSuccess: async () => {
      await invalidateUsers();
      setIsCreateOpen(false);
    },
  });
  const setRoleMutation = useMutation({
    ...trpc.admin.setRole.mutationOptions(),
    onSuccess: invalidateUsers,
  });
  const setSubscriptionOverrideMutation = useMutation({
    ...trpc.admin.setSubscriptionOverride.mutationOptions(),
    onSuccess: invalidateUsers,
  });
  const clearSubscriptionOverrideMutation = useMutation({
    ...trpc.admin.clearSubscriptionOverride.mutationOptions(),
    onSuccess: invalidateUsers,
  });
  const banUserMutation = useMutation({
    ...trpc.admin.banUser.mutationOptions(),
    onSuccess: invalidateUsers,
  });
  const unbanUserMutation = useMutation({
    ...trpc.admin.unbanUser.mutationOptions(),
    onSuccess: invalidateUsers,
  });
  const deleteUserMutation = useMutation({
    ...trpc.admin.deleteUser.mutationOptions(),
    onSuccess: async () => {
      await invalidateUsers();
      setSelectedUser(null);
    },
  });

  const pageStart = total === 0 ? 0 : offset + 1;
  const pageEnd = Math.min(offset + limit, total);
  const handleSort = (nextSortBy: SortBy) => {
    setSortDirection((currentDirection) =>
      sortBy === nextSortBy
        ? currentDirection === "asc"
          ? "desc"
          : "asc"
        : getDefaultSortDirection(nextSortBy),
    );
    setSortBy(nextSortBy);
    setOffset(0);
  };

  return (
    <main
      className={`admin-shell ${
        isSidebarOpen ? "sidebar-open" : "sidebar-collapsed"
      }`}
    >
      <aside
        aria-hidden={!isSidebarOpen}
        aria-label="Admin navigation"
        className="side-rail"
        id="admin-sidebar"
      >
        <div className="brand-lockup">
          <img alt="" className="brand-mark" src="/icons/icon.png" />
          <div>
            <strong>cookclub</strong>
            <span>Admin</span>
          </div>
        </div>
        <nav className="side-nav">
          <span className="active">
            <Users size={18} />
            Users
          </span>
        </nav>
        <div className="side-footer">
          <span>Console</span>
          <strong>Workspace</strong>
        </div>
      </aside>

      <button
        aria-controls="admin-sidebar"
        aria-expanded={isSidebarOpen}
        aria-label={isSidebarOpen ? "Hide sidebar" : "Show sidebar"}
        className="icon-button sidebar-toggle"
        onClick={() => setIsSidebarOpen((isOpen) => !isOpen)}
        title={isSidebarOpen ? "Hide sidebar" : "Show sidebar"}
        type="button"
      >
        {isSidebarOpen ? (
          <PanelLeftClose size={18} />
        ) : (
          <PanelLeftOpen size={18} />
        )}
      </button>

      <button
        aria-label="Close sidebar"
        className="sidebar-scrim"
        hidden={!isSidebarOpen}
        onClick={() => setIsSidebarOpen(false)}
        type="button"
      />

      <div className="dashboard-main">
        <header className="topbar">
          <div className="topbar-title-row">
            <div>
              <h1>Users</h1>
              <p className="topbar-copy">
                {pageStart}-{pageEnd} of {total.toLocaleString("en")} accounts
              </p>
            </div>
          </div>
          <div className="topbar-actions">
            <ThemeToggle onToggleTheme={onToggleTheme} theme={theme} />
            <span className="account-chip">
              <span className="account-dot" />
              <span className="signed-in">{currentUserEmail}</span>
            </span>
            <button
              aria-label="Log out"
              className="secondary-button logout-button"
              onClick={() => {
                onSignOut().catch((error) => console.error(error));
              }}
              title="Log out"
              type="button"
            >
              <LogOut size={18} />
              Log out
            </button>
          </div>
        </header>

        <section className="toolbar" aria-label="User controls">
          <div className="toolbar-top-row">
            <div className="toolbar-controls">
              <div className="toolbar-group filters" aria-label="Status">
                <span className="toolbar-group-label">Status</span>
                <div className="segmented-control" role="group">
                  {STATUS_FILTER_OPTIONS.map((option) => (
                    <button
                      aria-pressed={status === option.value}
                      className={status === option.value ? "active" : ""}
                      key={option.value || "all"}
                      onClick={() => {
                        setStatus(option.value);
                        setOffset(0);
                      }}
                      type="button"
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
              </div>
              <div className="toolbar-group filters" aria-label="Subscription">
                <span className="toolbar-group-label">Subscription</span>
                <div className="segmented-control compact" role="group">
                  {SUBSCRIPTION_FILTER_OPTIONS.map((option) => (
                    <button
                      aria-pressed={subscriptionStatus === option.value}
                      className={
                        subscriptionStatus === option.value ? "active" : ""
                      }
                      key={option.value || "all"}
                      onClick={() => {
                        setSubscriptionStatus(option.value);
                        setOffset(0);
                      }}
                      type="button"
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
              </div>
              <div className="toolbar-group filters" aria-label="Role">
                <span className="toolbar-group-label">Role</span>
                <div className="segmented-control compact" role="group">
                  {ROLE_FILTER_OPTIONS.map((option) => (
                    <button
                      aria-pressed={role === option.value}
                      className={role === option.value ? "active" : ""}
                      key={option.value || "all"}
                      onClick={() => {
                        setRole(option.value);
                        setOffset(0);
                      }}
                      type="button"
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </div>
          <div className="toolbar-search-row">
            <div className="search-control toolbar-search">
              <Search size={17} />
              <label className="sr-only" htmlFor="admin-user-search">
                Search users
              </label>
              <input
                id="admin-user-search"
                onChange={(event) => {
                  setSearch(event.target.value);
                  setOffset(0);
                }}
                placeholder="Search users"
                type="search"
                value={search}
              />
              {search ? (
                <button
                  aria-label="Clear search"
                  className="search-clear"
                  onClick={() => {
                    setSearch("");
                    setOffset(0);
                  }}
                  type="button"
                >
                  <X size={14} />
                </button>
              ) : null}
            </div>
            <div className="toolbar-actions">
              <button
                className="icon-button"
                onClick={() => {
                  usersQuery.refetch().catch((error) => console.error(error));
                }}
                title="Refresh"
              >
                <RefreshCw size={18} />
              </button>
              <button
                className="primary-button toolbar-create-button"
                onClick={() => setIsCreateOpen(true)}
              >
                <Plus size={18} />
                Create
              </button>
            </div>
          </div>
        </section>

        {usersQuery.error ? (
          <p className="notice error">{getErrorMessage(usersQuery.error)}</p>
        ) : null}

        <section className="table-shell" aria-label="Users">
          <table>
            <thead>
              <tr>
                <th aria-sort={getAriaSort(sortBy, sortDirection, "name")}>
                  <SortableHeader
                    direction={sortDirection}
                    isActive={sortBy === "name"}
                    label="User"
                    onClick={() => handleSort("name")}
                  />
                </th>
                <th aria-sort={getAriaSort(sortBy, sortDirection, "username")}>
                  <SortableHeader
                    direction={sortDirection}
                    isActive={sortBy === "username"}
                    label="Username"
                    onClick={() => handleSort("username")}
                  />
                </th>
                <th aria-sort={getAriaSort(sortBy, sortDirection, "email")}>
                  <SortableHeader
                    direction={sortDirection}
                    isActive={sortBy === "email"}
                    label="Email"
                    onClick={() => handleSort("email")}
                  />
                </th>
                <th aria-sort={getAriaSort(sortBy, sortDirection, "role")}>
                  <SortableHeader
                    direction={sortDirection}
                    isActive={sortBy === "role"}
                    label="Role"
                    onClick={() => handleSort("role")}
                  />
                </th>
                <th
                  aria-sort={getAriaSort(sortBy, sortDirection, "subscription")}
                >
                  <SortableHeader
                    direction={sortDirection}
                    isActive={sortBy === "subscription"}
                    label="Subscription"
                    onClick={() => handleSort("subscription")}
                  />
                </th>
                <th aria-sort={getAriaSort(sortBy, sortDirection, "status")}>
                  <SortableHeader
                    direction={sortDirection}
                    isActive={sortBy === "status"}
                    label="Status"
                    onClick={() => handleSort("status")}
                  />
                </th>
                <th aria-sort={getAriaSort(sortBy, sortDirection, "createdAt")}>
                  <SortableHeader
                    direction={sortDirection}
                    isActive={sortBy === "createdAt"}
                    label="Created"
                    onClick={() => handleSort("createdAt")}
                  />
                </th>
                <th aria-label="Actions" />
              </tr>
            </thead>
            <tbody>
              {usersQuery.isPending ? (
                <TableSkeleton />
              ) : users.length === 0 ? (
                <tr>
                  <td className="empty-row" colSpan={USER_TABLE_COLUMN_COUNT}>
                    No users
                  </td>
                </tr>
              ) : (
                users.map((item) => (
                  <tr key={item.id}>
                    <td>
                      <button
                        className="user-cell"
                        onClick={() => setSelectedUser(item)}
                      >
                        <Avatar user={item} />
                        <span>
                          <strong>{item.name}</strong>
                        </span>
                      </button>
                    </td>
                    <td>
                      {item.username ? (
                        <span className="text-cell">
                          {formatUsername(item.username)}
                        </span>
                      ) : (
                        <span className="muted-cell">None</span>
                      )}
                    </td>
                    <td>
                      <span className="text-cell email-cell">{item.email}</span>
                    </td>
                    <td>
                      <RoleBadge role={item.role} />
                    </td>
                    <td>
                      <SubscriptionBadge user={item} />
                    </td>
                    <td>
                      {item.banned ? (
                        <span className="status-badge banned">
                          <CircleSlash size={14} />
                          Banned
                        </span>
                      ) : (
                        <span className="status-badge active">
                          <CheckCircle2 size={14} />
                          Active
                        </span>
                      )}
                    </td>
                    <td>{formatDate(item.createdAt)}</td>
                    <td>
                      <button
                        className="icon-button"
                        onClick={() => setSelectedUser(item)}
                        title="Manage"
                      >
                        <UserCog size={18} />
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </section>

        <footer className="pagination">
          <span>
            {pageStart}-{pageEnd} of {total}
          </span>
          <div>
            <button
              className="icon-button"
              disabled={offset === 0}
              onClick={() => setOffset(Math.max(0, offset - limit))}
              title="Previous"
            >
              <ChevronLeft size={18} />
            </button>
            <button
              className="icon-button"
              disabled={offset + limit >= total}
              onClick={() => setOffset(offset + limit)}
              title="Next"
            >
              <ChevronRight size={18} />
            </button>
          </div>
        </footer>
      </div>

      {isCreateOpen ? (
        <CreateUserModal
          isPending={createUserMutation.isPending}
          error={getMutationError(createUserMutation.error)}
          onClose={() => setIsCreateOpen(false)}
          onCreate={(input) => createUserMutation.mutate(input)}
        />
      ) : null}

      {selectedUser ? (
        <UserDrawer
          user={selectedUser}
          mutations={{
            setRole: {
              error: setRoleMutation.error,
              isPending: setRoleMutation.isPending,
              mutate: setRoleMutation.mutate,
            },
            setSubscriptionOverride: {
              error: setSubscriptionOverrideMutation.error,
              isPending: setSubscriptionOverrideMutation.isPending,
              mutate: setSubscriptionOverrideMutation.mutate,
            },
            clearSubscriptionOverride: {
              error: clearSubscriptionOverrideMutation.error,
              isPending: clearSubscriptionOverrideMutation.isPending,
              mutate: clearSubscriptionOverrideMutation.mutate,
            },
            banUser: {
              error: banUserMutation.error,
              isPending: banUserMutation.isPending,
              mutate: banUserMutation.mutate,
            },
            unbanUser: {
              error: unbanUserMutation.error,
              isPending: unbanUserMutation.isPending,
              mutate: unbanUserMutation.mutate,
            },
            deleteUser: {
              error: deleteUserMutation.error,
              isPending: deleteUserMutation.isPending,
              mutate: deleteUserMutation.mutate,
            },
          }}
          onClose={() => setSelectedUser(null)}
        />
      ) : null}
    </main>
  );
}

function CreateUserModal({
  error,
  isPending,
  onClose,
  onCreate,
}: {
  error: string | null;
  isPending: boolean;
  onClose: () => void;
  onCreate: (input: {
    email: string;
    name: string;
    password: string;
    role: "admin" | "user";
  }) => void;
}) {
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<"admin" | "user">("user");

  return (
    <div className="modal-backdrop">
      <section className="modal" aria-label="Create user">
        <header className="drawer-header">
          <div>
            <p className="eyebrow">New user</p>
            <h2>Create user</h2>
          </div>
          <button className="icon-button" onClick={onClose} title="Close">
            <X size={18} />
          </button>
        </header>
        <form
          className="form-stack"
          onSubmit={(event) => {
            event.preventDefault();
            onCreate({ email, name, password, role });
          }}
        >
          <label>
            <FieldLabel required>Name</FieldLabel>
            <input
              onChange={(event) => setName(event.target.value)}
              required
              value={name}
            />
          </label>
          <label>
            <FieldLabel required>Email</FieldLabel>
            <input
              onChange={(event) => setEmail(event.target.value)}
              required
              type="email"
              value={email}
            />
          </label>
          <label>
            <FieldLabel required>Password</FieldLabel>
            <input
              minLength={8}
              onChange={(event) => setPassword(event.target.value)}
              required
              type="password"
              value={password}
            />
          </label>
          <label>
            <FieldLabel>Role</FieldLabel>
            <select
              onChange={(event) =>
                setRole(event.target.value as "admin" | "user")
              }
              value={role}
            >
              <option value="user">User</option>
              <option value="admin">Admin</option>
            </select>
          </label>
          {error ? <p className="form-error">{error}</p> : null}
          <div className="button-row">
            <button
              className="secondary-button"
              onClick={onClose}
              type="button"
            >
              Cancel
            </button>
            <button
              className="primary-button"
              disabled={isPending}
              type="submit"
            >
              <Plus size={18} />
              Create
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}

function UserDrawer({
  mutations,
  onClose,
  user,
}: {
  user: AdminUser;
  onClose: () => void;
  mutations: DrawerMutations;
}) {
  const [role, setRole] = useState<"admin" | "user">(getKnownRole(user.role));
  const [overrideStatus, setOverrideStatus] = useState<"pro" | "free">(
    user.subscription.tier,
  );
  const [overrideReason, setOverrideReason] = useState("");
  const [clearReason, setClearReason] = useState("");
  const [banReason, setBanReason] = useState("");
  const [banDays, setBanDays] = useState("");
  const [deleteEmail, setDeleteEmail] = useState("");
  const [isClosing, setIsClosing] = useState(false);
  const mutationError =
    getMutationError(mutations.setRole.error) ??
    getMutationError(mutations.setSubscriptionOverride.error) ??
    getMutationError(mutations.clearSubscriptionOverride.error) ??
    getMutationError(mutations.banUser.error) ??
    getMutationError(mutations.unbanUser.error) ??
    getMutationError(mutations.deleteUser.error);
  const deletionEmail = user.email.trim();
  const isDeleteConfirmed =
    deleteEmail.trim().toLowerCase() === deletionEmail.toLowerCase();
  const closeDrawer = () => {
    if (isClosing) return;

    setIsClosing(true);
    window.setTimeout(onClose, 260);
  };

  return (
    <aside className={`drawer-backdrop ${isClosing ? "drawer-closing" : ""}`}>
      <button
        aria-label="Close user settings"
        className="drawer-dismiss"
        onClick={closeDrawer}
        type="button"
      />
      <section className="drawer" aria-label="Manage user">
        <header className="drawer-header">
          <div className="drawer-user">
            <Avatar user={user} />
            <div>
              <p className="eyebrow">{user.role}</p>
              <h2>{user.name}</h2>
              {user.username ? (
                <span>{formatUsername(user.username)}</span>
              ) : null}
              <span>{user.email}</span>
            </div>
          </div>
          <button className="icon-button" onClick={closeDrawer} title="Close">
            <X size={18} />
          </button>
        </header>

        {mutationError ? <p className="notice error">{mutationError}</p> : null}

        <section className="drawer-section">
          <h3>Role</h3>
          <div className="inline-form">
            <select
              onChange={(event) =>
                setRole(event.target.value as "admin" | "user")
              }
              value={role}
            >
              <option value="user">User</option>
              <option value="admin">Admin</option>
            </select>
            <button
              className="secondary-button"
              disabled={mutations.setRole.isPending || role === user.role}
              onClick={() =>
                mutations.setRole.mutate({ userId: user.id, role })
              }
            >
              <ShieldCheck size={18} />
              Save
            </button>
          </div>
        </section>

        <section className="drawer-section">
          <h3>Subscription</h3>
          <div className="current-state">
            <SubscriptionBadge user={user} />
            {user.subscription.override ? (
              <span>{user.subscription.override.reason}</span>
            ) : null}
          </div>
          <div className="form-stack compact">
            <label>
              <span>Override</span>
              <select
                onChange={(event) =>
                  setOverrideStatus(event.target.value as "pro" | "free")
                }
                value={overrideStatus}
              >
                <option value="pro">Pro</option>
                <option value="free">Free</option>
              </select>
            </label>
            <label>
              <FieldLabel required>Reason</FieldLabel>
              <input
                onChange={(event) => setOverrideReason(event.target.value)}
                required
                value={overrideReason}
              />
            </label>
            <button
              className="secondary-button"
              disabled={
                mutations.setSubscriptionOverride.isPending ||
                overrideReason.trim().length === 0
              }
              onClick={() =>
                mutations.setSubscriptionOverride.mutate({
                  userId: user.id,
                  status: overrideStatus,
                  reason: overrideReason,
                })
              }
            >
              <CheckCircle2 size={18} />
              Set override
            </button>
            <label>
              <FieldLabel required>Clear reason</FieldLabel>
              <input
                onChange={(event) => setClearReason(event.target.value)}
                required
                value={clearReason}
              />
            </label>
            <button
              className="secondary-button"
              disabled={
                mutations.clearSubscriptionOverride.isPending ||
                clearReason.trim().length === 0
              }
              onClick={() =>
                mutations.clearSubscriptionOverride.mutate({
                  userId: user.id,
                  reason: clearReason,
                })
              }
            >
              <CircleSlash size={18} />
              Clear override
            </button>
          </div>
        </section>

        <section className="drawer-section">
          <h3>Access</h3>
          {user.banned ? (
            <button
              className="secondary-button"
              disabled={mutations.unbanUser.isPending}
              onClick={() => mutations.unbanUser.mutate({ userId: user.id })}
            >
              <CheckCircle2 size={18} />
              Unban
            </button>
          ) : (
            <div className="form-stack compact">
              <label>
                <FieldLabel required>Reason</FieldLabel>
                <input
                  onChange={(event) => setBanReason(event.target.value)}
                  required
                  value={banReason}
                />
              </label>
              <label>
                <FieldLabel>Days</FieldLabel>
                <input
                  min={1}
                  onChange={(event) => setBanDays(event.target.value)}
                  type="number"
                  value={banDays}
                />
              </label>
              <button
                className="danger-button"
                disabled={
                  mutations.banUser.isPending || banReason.trim().length === 0
                }
                onClick={() => {
                  const days = Number(banDays);
                  mutations.banUser.mutate({
                    userId: user.id,
                    reason: banReason,
                    ...(Number.isFinite(days) && days > 0
                      ? { banExpiresIn: days * 24 * 60 * 60 }
                      : {}),
                  });
                }}
              >
                <Ban size={18} />
                Ban
              </button>
            </div>
          )}
        </section>

        <section className="drawer-section danger-zone">
          <h3>Delete</h3>
          <div className="form-stack compact">
            <label>
              <FieldLabel required>Confirmation email</FieldLabel>
              <input
                aria-describedby="delete-confirmation-help"
                autoComplete="off"
                inputMode="email"
                onChange={(event) => setDeleteEmail(event.target.value)}
                placeholder={deletionEmail}
                required
                spellCheck={false}
                type="email"
                value={deleteEmail}
              />
            </label>
            <p className="field-help" id="delete-confirmation-help">
              Type {deletionEmail} to enable deletion.
            </p>
            <button
              className="danger-button"
              disabled={mutations.deleteUser.isPending || !isDeleteConfirmed}
              onClick={() =>
                mutations.deleteUser.mutate({
                  userId: user.id,
                  confirmationEmail: deleteEmail,
                })
              }
            >
              <Trash2 size={18} />
              Delete account
            </button>
          </div>
        </section>
      </section>
    </aside>
  );
}

function FieldLabel({
  children,
  required = false,
}: {
  children: string;
  required?: boolean;
}) {
  return (
    <span className="field-label">
      {children}
      {required ? <span className="required-marker">Required</span> : null}
    </span>
  );
}

function ThemeToggle({
  onToggleTheme,
  theme,
}: {
  onToggleTheme: () => void;
  theme: ResolvedTheme;
}) {
  const isDark = theme === "dark";
  const Icon = isDark ? Sun : Moon;
  const label = isDark ? "Use light mode" : "Use dark mode";

  return (
    <button
      aria-label={label}
      className="icon-button theme-toggle"
      onClick={onToggleTheme}
      title={label}
      type="button"
    >
      <Icon size={18} />
    </button>
  );
}

function SortableHeader({
  direction,
  isActive,
  label,
  onClick,
}: {
  direction: SortDirection;
  isActive: boolean;
  label: string;
  onClick: () => void;
}) {
  const nextDirection =
    isActive && direction === "asc" ? "descending" : "ascending";
  const Icon = isActive
    ? direction === "asc"
      ? ArrowUp
      : ArrowDown
    : ArrowUpDown;

  return (
    <button
      aria-label={`Sort ${label} ${nextDirection}`}
      aria-pressed={isActive}
      className={`sort-header ${isActive ? "active" : ""}`}
      onClick={onClick}
      title={`Sort ${label} ${nextDirection}`}
      type="button"
    >
      <span>{label}</span>
      <Icon aria-hidden="true" className="sort-header-icon" size={14} />
    </button>
  );
}

function TableSkeleton() {
  return Array.from({ length: 6 }).map((_, index) => (
    <tr key={index}>
      <td colSpan={USER_TABLE_COLUMN_COUNT}>
        <div className="skeleton-line" />
      </td>
    </tr>
  ));
}

function Avatar({
  user,
}: {
  user: Pick<AdminUser, "image" | "name" | "email">;
}) {
  if (user.image) {
    return <img alt="" className="avatar" src={user.image} />;
  }

  return (
    <span className="avatar fallback">
      {(user.name || user.email).slice(0, 1).toUpperCase()}
    </span>
  );
}

function RoleBadge({ role }: { role: AdminUser["role"] }) {
  return (
    <span className={`role-badge ${role === "admin" ? "admin" : "user"}`}>
      {role}
    </span>
  );
}

function SubscriptionBadge({ user }: { user: AdminUser }) {
  const tier = user.subscription.tier;
  const sourceLabel = getSubscriptionSourceLabel(user.subscription.source);

  return (
    <span className={`subscription-badge ${tier}`}>
      {tier === "pro" ? "Pro" : "Free"}
      {sourceLabel ? <small>{sourceLabel}</small> : null}
    </span>
  );
}

function getSubscriptionSourceLabel(
  source: AdminUser["subscription"]["source"],
) {
  if (source === "free") return null;
  if (source === "adapty") return "Adapty";
  return "Manual";
}

function getKnownRole(role: string) {
  return role === "admin" ? "admin" : "user";
}

function getAriaSort(
  sortBy: SortBy,
  sortDirection: SortDirection,
  column: SortBy,
) {
  if (sortBy !== column) return undefined;
  return sortDirection === "asc" ? "ascending" : "descending";
}

function getDefaultSortDirection(sortBy: SortBy): SortDirection {
  return sortBy === "createdAt" || sortBy === "updatedAt" ? "desc" : "asc";
}

function formatDate(value: string | Date) {
  return new Intl.DateTimeFormat("en", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(new Date(value));
}

function formatUsername(username: string) {
  return username.startsWith("@") ? username : `@${username}`;
}

function getStoredThemeMode(): ThemeMode {
  if (typeof window === "undefined") return "system";

  try {
    const storedTheme = window.localStorage.getItem(THEME_STORAGE_KEY);
    if (storedTheme === "dark" || storedTheme === "light") {
      return storedTheme;
    }
  } catch (error) {
    console.error(error);
  }

  return "system";
}

function resolveThemeMode(themeMode: ThemeMode): ResolvedTheme {
  if (themeMode !== "system") return themeMode;
  if (typeof window === "undefined") return "light";

  return window.matchMedia("(prefers-color-scheme: dark)").matches
    ? "dark"
    : "light";
}

function getAdminCallbackUrl() {
  if (typeof window === "undefined") return "/";

  return `${window.location.origin}/`;
}

function getOAuthErrorMessage(error: string, description: string | null) {
  if (description) return `Google sign in failed: ${description}`;

  return `Google sign in failed: ${error.replaceAll("_", " ")}`;
}

function getMutationError(error: unknown) {
  return error ? getErrorMessage(error) : null;
}

function getErrorMessage(error: unknown) {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  return "Something went wrong.";
}
