import { Alert } from "react-native";

interface Person {
  id: string;
  name: string;
}

const joinNames = (names: string[]) =>
  names.length < 2
    ? names.join("")
    : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;

/**
 * Invites everyone picked, then shows one alert naming anyone whose invite
 * didn't send, instead of one alert per failure.
 */
export async function inviteAll(
  userIds: string[],
  invite: (userId: string) => Promise<unknown>,
  people: Person[] | undefined,
  /** Where to try again, e.g. "the plan's sharing" */
  retryFrom: string,
) {
  const results = await Promise.allSettled(userIds.map(invite));
  const failed = userIds.filter((_, i) => results[i]?.status === "rejected");
  if (!failed.length) return;
  const names = failed.map(
    (id) => people?.find((p) => p.id === id)?.name.split(" ")[0] ?? "someone",
  );
  Alert.alert(
    "Some invites didn't send",
    `Couldn't invite ${joinNames(names)}. You can try again from ${retryFrom}.`,
  );
}
