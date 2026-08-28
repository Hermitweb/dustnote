/**
 * 移动端斜杠命令菜单
 */

import React from 'react';
import { View, Text, TouchableOpacity, FlatList, StyleSheet } from 'react-native';
import type { SlashCommand } from '../lib/slash-commands';
import type { ThemeColors } from '../theme';

interface Props {
  commands: SlashCommand[];
  visible: boolean;
  onSelect: (cmd: SlashCommand) => void;
  colors: ThemeColors;
}

export function SlashCommandMenu({ commands, visible, onSelect, colors }: Props) {
  if (!visible || commands.length === 0) return null;

  return (
    <View style={[styles.container, { backgroundColor: colors.card, borderColor: colors.border }]}>
      <FlatList
        data={commands}
        keyExtractor={(item) => item.id}
        keyboardShouldPersistTaps="handled"
        style={{ maxHeight: 240 }}
        renderItem={({ item }) => (
          <TouchableOpacity
            style={[styles.item, { borderBottomColor: colors.border }]}
            onPress={() => onSelect(item)}
          >
            <Text style={styles.icon}>{item.icon}</Text>
            <Text style={[styles.label, { color: colors.fg }]}>{item.label}</Text>
          </TouchableOpacity>
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    bottom: 60,
    left: 16,
    right: 16,
    borderRadius: 12,
    borderWidth: 1,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15,
    shadowRadius: 8,
    elevation: 5,
    zIndex: 100,
  },
  item: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  icon: {
    fontSize: 18,
    marginRight: 12,
  },
  label: {
    fontSize: 14,
    fontWeight: '500',
  },
});
