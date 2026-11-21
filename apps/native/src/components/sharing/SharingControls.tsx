import { Pressable, View } from "react-native";
import { StyleSheet, useUnistyles } from "react-native-unistyles";

import { Avatar } from "@/components/Avatar";
import { SystemIcon } from "@/components/SystemIcon";
import { Text } from "@/components/Text";

export interface SharingMember {
  id: string;
  name: string;
  image?: string | null;
  /** Invited but hasn't joined yet: shown faded. */
  pending?: boolean;
}

const FACE = 24;
const OVERLAP = 7;
const MAX_FACES = 3;

const firstName = (member: SharingMember) =>
  member.name.trim().split(" ")[0] || "Someone";

const names = (people: SharingMember[]) => {
  if (people.length === 1) return firstName(people[0]!);
  if (people.length === 2) return people.map(firstName).join(" and ");
  return `${firstName(people[0]!)}, ${firstName(people[1]!)} and ${people.length - 2} more`;
};

/**
 * Who's joined, then how many are invited: "Just you", "Sam and Mei",
 * "Sam, Mei and 4 more", "Sam · 2 invited", "Just you · 1 invited"
 */
export const peopleSummary = (members: SharingMember[]) => {
  const joined = members.slice(1).filter((m) => !m.pending);
  const invited = members.filter((m) => m.pending).length;
  const who = joined.length ? names(joined) : "Just you";
  return invited ? `${who} · ${invited} invited` : who;
};

/** Everyone on a plan or list, you first, with anyone invited faded. */
const MemberFaces = ({ members }: { members: SharingMember[] }) => (
  <View style={styles.faces}>
    {members.slice(0, MAX_FACES).map((member, i) => (
      <View
        key={member.id}
        style={[
          styles.face,
          i > 0 && styles.overlap,
          { zIndex: MAX_FACES - i },
          member.pending && styles.pending,
        ]}
      >
        <Avatar imageUrl={member.image} name={member.name} size={FACE - 4} />
      </View>
    ))}
  </View>
);

interface PeopleLineProps {
  /** Everyone on it, you first. */
  members: SharingMember[];
  /** Opens who's on it. Without it the line is just information. */
  onPress?: () => void;
  /** Shows an Invite pill when set. */
  onInvite?: () => void;
}

/**
 * Who's on a plan or list, as a line under its name: their faces and
 * names, then an Invite pill if you can invite people.
 */
export const PeopleLine = ({ members, onPress, onInvite }: PeopleLineProps) => {
  const { theme } = useUnistyles();
  const summary = peopleSummary(members);
  const content = (
    <>
      <MemberFaces members={members} />
      <Text type="subheadline" numberOfLines={1} style={styles.names}>
        {summary}
      </Text>
      {onPress ? (
        <SystemIcon
          sf="chevron.right"
          android="chevron-forward"
          size={12}
          color={theme.colors.textSecondary}
        />
      ) : null}
    </>
  );
  return (
    <View style={styles.row}>
      {onPress ? (
        <Pressable
          onPress={onPress}
          hitSlop={8}
          style={({ pressed }) => [styles.people, pressed && styles.pressed]}
          accessibilityRole="button"
          accessibilityLabel={summary}
          accessibilityHint="Shows who's on it"
        >
          {content}
        </Pressable>
      ) : (
        <View style={styles.people} accessible accessibilityLabel={summary}>
          {content}
        </View>
      )}
      {onInvite ? (
        <Pressable
          onPress={onInvite}
          hitSlop={8}
          style={({ pressed }) => [styles.invite, pressed && styles.pressed]}
          accessibilityRole="button"
          accessibilityLabel="Invite someone"
        >
          <SystemIcon
            sf="person.badge.plus"
            android="person-add-outline"
            size={14}
            color={theme.colors.primary}
          />
          <Text type="subheadline" style={styles.inviteText}>
            Invite
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
};

const styles = StyleSheet.create((theme) => ({
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  people: {
    flexShrink: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
    minHeight: 28,
  },
  pressed: {
    opacity: 0.6,
  },
  names: {
    flexShrink: 1,
    color: theme.colors.textSecondary,
    fontFamily: theme.fonts.semiBold,
  },
  faces: {
    flexDirection: "row",
    alignItems: "center",
  },
  face: {
    width: FACE,
    height: FACE,
    borderRadius: FACE / 2,
    borderWidth: 2,
    borderColor: theme.colors.background,
    backgroundColor: theme.colors.background,
    alignItems: "center",
    justifyContent: "center",
  },
  overlap: {
    marginLeft: -OVERLAP,
  },
  pending: {
    opacity: 0.45,
  },
  invite: {
    height: 28,
    paddingLeft: 8,
    paddingRight: 11,
    borderRadius: 14,
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    backgroundColor: theme.colors.primary + "1A",
  },
  inviteText: {
    color: theme.colors.primary,
    fontFamily: theme.fonts.bold,
  },
}));
