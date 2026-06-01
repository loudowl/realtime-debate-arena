import React from 'react';
import { View, Text, Button, StyleSheet } from 'react-native';

const HomeScreen = ({ navigation }) => {
  return (
    <View style={styles.container}>
      <Text style={styles.title}>Welcome to Realtime Debate Arena</Text>
      <Button title="Join a Debate" onPress={() => navigation.navigate('Debate')} />
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
    marginBottom: 20,
  },
});

export default HomeScreen;
