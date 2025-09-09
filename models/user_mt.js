import mongoose, { Schema, model } from "mongoose";

const userSchema = new mongoose.Schema({
  username: { type: String, required: true , unique:true},
  hashedPassword: { type: String, required: true },
  name: {type: String, required: true},
  role:{type: String,
    enum:['receptionist','doctor'],
    required:true
  }
  
});

userSchema.set("toJSON", {
  transform: (doc, ret) => {
    delete ret.hashedPassword;
  },
});

export default model("User", userSchema);
