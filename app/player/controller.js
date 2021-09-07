const Player = require("./model")
const Voucher = require("../voucher/model")
const Category = require("../category/model")
const Payment = require("../payment/model")
const Bank = require("../bank/model")
const Nominal = require("../nominal/model")
const Transaction = require("../transaction/model")
const path = require("path")
const fs = require("fs")
const config = require("../../config")

module.exports = {
  landingPage: async (req, res) => {
    try {
      const voucher = await Voucher.find()
        .select("_id name status category thumbnail")
        .populate("category")
      res.status(200).send(voucher)
    } catch (err) {
      res.status(500).send(err.message)
    }
  },
  detailPage: async (req, res) => {
    try {
      const { id } = req.params
      const voucher = await Voucher.findById(id)
        .populate("category")
        .populate("nominals")
        .populate("user", "_id name phoneNumber")

      if (!voucher) return res.status(404).send("Voucher Game tidak ditemukan.!")

      res.status(200).send(voucher)
    } catch (err) {
      res.status(500).send(err.message)
    }
  },
  category: async (req, res) => {
    try {
      const category = await Category.find()
      res.status(200).send(category)
    } catch (err) {
      res.status(500).send(err.message)
    }
  },
  checkout: async (req, res) => {
    try {
      const { accountUser, name, nominal, voucher, payment, bank } = req.body

      const res_voucher = await Voucher.findById(voucher)
        .select("name category _id thumbnail user")
        .populate("category")
        .populate("user")

      if (!res_voucher) return res.status(404).send("Voucher game tidak ditemukan.")

      const res_nominal = await Nominal.findById(nominal)

      if (!res_nominal) return res.status(404).send("Nominal tidak ditemukan.")

      const res_payment = await Payment.findById(payment)

      if (!res_payment) return res.status(404).send("Payment tidak ditemukan.")

      const res_bank = await Bank.findById(bank)

      if (!res_bank) return res.status(404).send("bank tidak ditemukan.")

      const tax = (10 / 100) * res_nominal._doc.price
      const value = res_nominal._doc.price - tax

      const payload = {
        historyVoucherTopup: {
          gameName: res_voucher._doc.name,
          category: res_voucher._doc.category ? res_voucher._doc.category.name : "",
          thumbnail: res_voucher._doc.thumbnail,
          coinName: res_nominal._doc.coinName,
          coinQuantity: res_nominal._doc.coinQuantity,
          price: res_nominal._doc.price,
        },
        historyPayment: {
          name: res_bank._doc.name,
          type: res_payment._doc.type,
          bankName: res_bank._doc.bankName,
          noRekening: res_bank._doc.noRekening,
        },

        name,
        accountUser,
        tax,
        value,
        player: req.player._id,
        historyUser: {
          name: res_voucher._doc.user?._name,
          phoneNumber: res_voucher._doc.user?.phoneNumber,
        },

        category: res_voucher._doc.category?._id,
        user: res_voucher._doc.user?._id,
      }

      const transaction = new Transaction(payload)
      await transaction.save()

      res.status(201).send(transaction)
    } catch (err) {
      res.status(500).send(err.message)
    }
  },

  history: async (req, res) => {
    try {
      const { status = "" } = req.query

      let criteria = {}

      if (status.length) {
        criteria = {
          ...criteria,
          status: { $regex: `${status}`, $options: "i" },
        }
      }

      if (req.player._id) {
        criteria = {
          ...criteria,
          player: req.player._id,
        }
      }

      const history = await Transaction.find(criteria)

      let total = await Transaction.aggregate([
        { $match: criteria },
        {
          $group: {
            _id: null,
            value: { $sum: "$value" },
          },
        },
      ])

      res.status(200).send({ data: history, total: total.length ? total[0].value : 0 })
    } catch (err) {
      res.status(500).send(err.message)
    }
  },
  historyDetail: async (req, res) => {
    try {
      const { id } = req.params

      const history = await Transaction.findById(id)

      if (!history) return res.status(404).send("History tidak ditemukan")

      res.status(200).send(history)
    } catch (err) {
      res.status(500).send(err.message)
    }
  },
  dashboard: async (req, res) => {
    try {
      const count = await Transaction.aggregate([
        {
          $match: { player: req.player._id },
        },
        {
          $group: {
            _id: "$category",
            value: { $sum: "$value" },
          },
        },
      ])

      const category = await Category.find()

      category.forEach((element) => {
        count.forEach((data) => {
          if (data._id.toString() === element._id.toString()) {
            data.name = element.name
          }
        })
      })

      const history = await Transaction.find({ player: req.player._id })
        .populate("category")
        .sort({ updatedAt: -1 })

      res.status(200).send({
        data: history,
        count,
      })
    } catch (err) {
      res.status(500).send(err.message)
    }
  },

  profile: async (req, res) => {
    try {
      const player = {
        id: req.player._id,
        username: req.player.username,
        email: req.player.email,
        name: req.player.name,
        avatar: req.player.avatar,
        phoneNumber: req.player.phoneNumber,
      }

      res.status(200).send(player)
    } catch (err) {
      res.status(500).send(err.message)
    }
  },

  editProfile: async (req, res, next) => {
    try {
      const { name = "", phoneNumber = "" } = req.body

      const payload = {}

      if (name.length) payload.name = name
      if (phoneNumber.length) payload.phoneNumber = phoneNumber

      if (req.file) {
        let tmp_path = req.file.path
        let originalExt =
          req.file.originalname.split(".")[req.file.originalname.split(".").length - 1]
        let filename = req.file.filename + "." + originalExt
        let target_path = path.resolve(config.rootPath, `public/uploads/${filename}`)

        const src = fs.createReadStream(tmp_path)
        const dest = fs.createWriteStream(target_path)

        src.pipe(dest)

        src.on("end", async () => {
          let player = await Player.findById(req.player._id)

          let currentImage = `${config.rootPath}/public/uploads/${player.avatar}`
          if (fs.existsSync(currentImage)) {
            fs.unlinkSync(currentImage)
          }

          player = await Player.findByIdAndUpdate(
            req.player._id,
            {
              ...payload,
              avatar: filename,
            },
            { new: true, runValidators: true }
          )

          res.status(201).send({
            id: player._id,
            name: player.name,
            phoneNumber: player.phoneNumber,
            avatar: player.avatar,
          })
        })

        src.on("err", async () => {
          next(err)
        })
      } else {
        const player = await Player.findByIdAndUpdate(
          {
            _id: req.player._id,
          },
          payload,
          { new: true, runValidators: true }
        )

        res.status(201).send({
          id: player._id,
          name: player.name,
          phoneNumber: player.phoneNumber,
          avatar: player.avatar,
        })
      }
    } catch (err) {
      if (err && err.name === "ValidationError") {
        res.status(422).send({
          error: 1,
          message: err.message,
          fields: err.errors,
        })
      }
    }
  },
}
