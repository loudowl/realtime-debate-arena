import React from 'react';
import { View, Text, StyleSheet } from 'react-native';

const DebateScreen = () => {
  return (
    <View style={styles.container}>
      <Text style={styles.title}>Debate Screen</Text>
      <Text style={styles.subtitle}>Live debate content will appear here.</Text>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#ECF0F1',
  },
  title: {
    fontSize: 24,
    color: '#2C3E50',
    marginBottom: 10,
  },
  subtitle: {
    fontSize: 18,
    color: '#34495E',
  },
});

export default DebateScreen;
